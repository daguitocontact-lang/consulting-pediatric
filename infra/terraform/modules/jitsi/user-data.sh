#!/bin/bash
# Provisioning for the consultation's Jitsi. Runs once, on first boot: the box
# is stateless and rebuilt rather than patched, so THIS FILE is what is running.
#
# Everything it does that the Jitsi quick-install does not:
#   - a swap file (three JVMs and prosody on 2 GB),
#   - the NAT harvester (an EC2 box does not know its own public address, and a
#     videobridge that advertises 10.0.x.y connects the room and then carries no
#     media at all — the failure looks like "everything works but nobody hears"),
#   - the JWT module, with the secret read from SSM and never written here,
#   - a wait for the Elastic IP and its DNS before asking Let's Encrypt for a
#     certificate, which is the whole difference between an unattended install
#     that works and one that ends on a self-signed cert.
#
# Log: /var/log/jitsi-bootstrap.log (and cloud-init's own output).
set -euxo pipefail
exec > >(tee -a /var/log/jitsi-bootstrap.log) 2>&1
# Without this a failed command just stops the script mid-way and the box looks
# like it is still installing, forever. It has to SAY where it stopped.
trap 'echo "[jitsi-bootstrap] FAILED at line $LINENO"' ERR

FQDN="${hostname}"
APP_ID="${app_id}"
SECRET_PARAM="${secret_param}"
REGION="${region}"
LE_EMAIL="${le_email}"
PUBLIC_IP="${public_ip}"
VIDEO_HEIGHT="${video_height}"

export DEBIAN_FRONTEND=noninteractive

imds() {
  local tok
  tok=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
  curl -fsS -H "X-aws-ec2-metadata-token: $tok" "http://169.254.169.254/latest/meta-data/$1"
}

# ── Identity ─────────────────────────────────────────────────────────
# The installer derives prosody's virtual host and the certificate name from
# this, so it has to be the real public name before a single package lands.
hostnamectl set-hostname "$FQDN"
grep -q "$FQDN" /etc/hosts || echo "127.0.0.1 $FQDN" >> /etc/hosts

# ── Swap ─────────────────────────────────────────────────────────────
# t4g.small is 2 GB and jvb + jicofo + prosody idle around 1.2 GB. Without this
# the OOM killer takes the videobridge mid-consultation.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# ── Base packages ────────────────────────────────────────────────────
# nginx goes in BEFORE jitsi-meet: the package picks its web server at install
# time and falls back to jetty when it finds none, and jetty cannot host the
# TURN fallback on 443.
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg2 apt-transport-https dnsutils jq unzip nginx-full

# The AWS CLI, for the one call that reads the room secret out of SSM. From
# Amazon's installer and not from apt: Ubuntu 24.04 dropped the `awscli` deb
# (it is a snap there now), and `apt-get install awscli` fails outright with
# "no installation candidate" — which, under `set -e`, ends the whole boot.
if ! command -v aws >/dev/null; then
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/awscliv2.zip /tmp/aws
fi

# ── Jitsi repository ─────────────────────────────────────────────────
install -d -m 0755 /usr/share/keyrings
curl -fsSL https://download.jitsi.org/jitsi-key.gpg.key |
  gpg --dearmor -o /usr/share/keyrings/jitsi-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/jitsi-keyring.gpg] https://download.jitsi.org stable/" \
  > /etc/apt/sources.list.d/jitsi-stable.list
apt-get update

# ── jitsi-meet, unattended ───────────────────────────────────────────
# Self-signed first, on purpose: Let's Encrypt cannot answer until the Elastic
# IP is attached and DNS has caught up, and that is minutes away yet.
debconf-set-selections <<EOF
jitsi-videobridge jitsi-videobridge/jvb-hostname string $FQDN
jitsi-meet-web-config jitsi-meet/cert-choice select Generate a new self-signed certificate (You will later get a chance to obtain a Let's encrypt certificate)
EOF
apt-get install -y jitsi-meet

# ── The NAT harvester ────────────────────────────────────────────────
# The single most important six lines in this file. ice4j offers candidates by
# looking at the interfaces it can see, and on EC2 every one of them is private.
LOCAL_IP=$(imds local-ipv4)
JVB_PROPS=/etc/jitsi/videobridge/sip-communicator.properties
if ! grep -q NAT_HARVESTER_PUBLIC_ADDRESS "$JVB_PROPS"; then
  cat >> "$JVB_PROPS" <<EOF
org.ice4j.ice.harvest.NAT_HARVESTER_LOCAL_ADDRESS=$LOCAL_IP
org.ice4j.ice.harvest.NAT_HARVESTER_PUBLIC_ADDRESS=$PUBLIC_IP
EOF
fi

# ── Wait for the address and its name ────────────────────────────────
# The Elastic IP is associated by a separate terraform resource, so it lands
# some seconds AFTER this box booted; the DNS record is created in the same
# apply. Asking Let's Encrypt before either is ready burns one of five weekly
# attempts per domain and leaves the self-signed certificate in place.
for _ in $(seq 1 60); do
  [ "$(imds public-ipv4 || true)" = "$PUBLIC_IP" ] && break
  sleep 5
done
for _ in $(seq 1 60); do
  [ "$(dig +short @1.1.1.1 "$FQDN" A | tail -1)" = "$PUBLIC_IP" ] && break
  sleep 10
done

# ── Certificate ──────────────────────────────────────────────────────
# Not fatal: a box with a self-signed certificate is reachable over SSM and one
# rerun of this script away from a real one, whereas a failed boot is a box with
# nothing on it. It IS loud, because until this succeeds the panel cannot even
# load external_api.js from here.
if ! echo "$LE_EMAIL" | /usr/share/jitsi-meet/scripts/install-letsencrypt-cert.sh; then
  echo "[jitsi-bootstrap] LET'S ENCRYPT FAILED — the server is serving a SELF-SIGNED certificate." \
    "The panel will refuse to load external_api.js until this is fixed." \
    "Rerun: /usr/share/jitsi-meet/scripts/install-letsencrypt-cert.sh"
fi

# ── The JWT module ───────────────────────────────────────────────────
# What turns the room from "anyone with the name" into "anyone the API let in".
# xtrace off around the secret: this script's log is root-only, but a secret
# that is never printed cannot be leaked by a log that is later copied out.
APP_SECRET=$(aws ssm get-parameter --region "$REGION" --name "$SECRET_PARAM" \
  --with-decryption --query Parameter.Value --output text)
set +x
debconf-set-selections <<EOF
jitsi-meet-tokens jitsi-meet-tokens/appid string $APP_ID
jitsi-meet-tokens jitsi-meet-tokens/appsecret password $APP_SECRET
EOF
set -x
unset APP_SECRET
apt-get install -y jitsi-meet-tokens

# Ubuntu 24.04 ships `lua-inspect` for Lua 5.1/5.2/5.3 and prosody 0.12.4 runs
# on 5.4, so `mod_token_verification` dies on `module 'inspect' not found` —
# and the way that fails is vicious: prosody STARTS, jitsi looks healthy, and
# then `authentication = "token"` has no SASL mechanism, so every joiner is
# accepted and dropped. In the browser it reads "Ha sido desconectado.
# Reconectando en 5 segundos", forever, which looks like a network problem and
# is not one. `basexx` and `cjson` ship a 5.4 build; `inspect` is the only gap.
if [ ! -f /usr/share/lua/5.4/inspect.lua ]; then
  cp /usr/share/lua/5.3/inspect.lua /usr/share/lua/5.4/inspect.lua
fi

# Moderation stays as jicofo ships it: whoever arrives first owns the room. The
# token's `moderator` claim is NOT enforced here, because doing that means
# loading mod_token_moderation into prosody and turning enable-auto-owner off —
# and a prosody that fails to load a module does not start, which on an
# unattended boot is the whole server rather than one wrong flag. In practice
# the doctor opens the room and then sends the link, and the parent's token
# already carries every feature false (recording, transcription, dial-out).

# ── Overrides ────────────────────────────────────────────────────────
# Appended, not merged: the package owns this file and rewrites it on upgrade,
# and a rebuild of the box runs this again.
CONFIG="/etc/jitsi/meet/$FQDN-config.js"
if ! grep -q "custom overrides" "$CONFIG"; then
  cat >> "$CONFIG" <<EOF

// ── custom overrides (terraform user_data) ──────────────────────────
// p2p is left ON (the default) and that is the cost decision: a consultation is
// two endpoints, so the media goes browser-to-browser and this box carries only
// signalling. It relays — and bills egress — for the calls where p2p fails.
config.constraints = { video: { height: { ideal: $VIDEO_HEIGHT, max: $VIDEO_HEIGHT, min: 180 } } };
config.videoQuality = Object.assign({}, config.videoQuality || {}, {
  maxBitratesVideo: {
    VP8: { low: 200000, standard: 500000, high: 1200000 },
    VP9: { low: 100000, standard: 300000, high: 1200000 },
    H264: { low: 200000, standard: 500000, high: 1200000 },
  },
});
// No gravatar / no callstats: a consultation does not phone third parties.
config.disableThirdPartyRequests = true;
EOF
fi

systemctl enable prosody jicofo jitsi-videobridge2 nginx
systemctl restart prosody
systemctl restart jicofo
systemctl restart jitsi-videobridge2
systemctl restart nginx

echo "[jitsi-bootstrap] done: https://$FQDN (app id $APP_ID)"
