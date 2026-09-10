# Costo de infraestructura por custom (IaC)

Estimación **mensual** en AWS `us-east-1` con el stack más barato del estándar
(RDS t4g.micro + Fargate Spot + Cloudflare Tunnel, sin ALB ni NAT Gateway).
Cifras a precio público on-demand; con Savings Plans / Reserved bajan ~30–40%.

## Desglose mensual

| Recurso | Config | Costo on-demand | Con Spot/RI |
| --- | --- | ---: | ---: |
| **RDS PostgreSQL** | `db.t4g.micro`, single-AZ | ~$11.70 | ~$7 (RI 1y) |
| RDS almacenamiento | 20 GB gp3 | ~$2.30 | ~$2.30 |
| RDS backups | 20 GB incluidos (1 día) | $0 | $0 |
| **ECS Fargate (API)** | 0.25 vCPU / 0.5 GB, 1 tarea 24/7 | ~$9.00 | ~$2.70 (Spot) |
| **IPv4 pública** | 1 IP en la tarea (egress) | ~$3.60 | ~$3.60 |
| **Cloudflare Tunnel + DNS** | plan free | **$0** | $0 |
| ECR | 1–2 imágenes (~1 GB) | ~$0.10 | ~$0.10 |
| CloudWatch Logs | ~1 GB/mes | ~$0.50 | ~$0.50 |
| S3 + DynamoDB (TF state) | mínimo | ~$0.15 | ~$0.15 |
| Data transfer (egress) | bajo volumen | ~$1.00 | ~$1.00 |
| **TOTAL** | | **≈ $28 / mes** | **≈ $17 / mes** |

## Jitsi propio (opcional: `jitsi_self_hosted = true`)

Fuera del total de arriba, porque es la única pieza que no cabe en el diseño
barato: el media es **UDP/10000**, y un Cloudflare Tunnel lleva TCP. Hay que
pagar las dos cosas que el resto del stack evita — un EC2 24/7 y una IP pública
fija — y no hay versión Fargate/Spot razonable (un reclaim a mitad de consulta
saca al médico y al papá de la sala, y no hay a qué hacer failover).

| Recurso | Config | Costo |
| --- | --- | ---: |
| **EC2** | `t4g.small` (2 vCPU / 2 GB, ARM), on-demand | ~$12.26 |
| EBS | 20 GB gp3 | ~$1.60 |
| **IPv4 pública (EIP)** | 1, fija | ~$3.65 |
| Backups | ninguno — la caja es stateless, se reconstruye del `user-data.sh` | $0 |
| **Subtotal fijo** | | **≈ $17.50** |

`t4g.medium` (4 GB) en vez del small: **+$12/mes**. Savings Plan a 1 año: **−30%**
sobre el EC2.

### El egress, que es la parte variable

Jitsi es un SFU: no transcodifica, **reenvía**. Pero una consulta son DOS
extremos y `p2p` viene **encendido**, así que el video va navegador↔navegador y
la caja no toca el media: solo señalización. Paga egress únicamente cuando el
p2p falla (NAT simétrico, firewall de hospital) y la llamada cae al relay.

| Horas RELAYADAS / mes | GB egress (720p) | Costo (100 GB gratis, luego $0.09/GB) |
| ---: | ---: | ---: |
| 50 h | 75 GB | **$0** |
| 200 h | 300 GB | **~$18** |
| 500 h | 750 GB | **~$59** |

Marginal: **~$0.14 por hora relayada** a 720p. `jitsi_video_height = 360` lo baja
a **~$0.05/h**, y esa es la palanca de costo si el relay resulta ser la norma y
no la excepción.

### Total

| Escenario | Jitsi | Stack completo |
| --- | ---: | ---: |
| `t4g.small`, poco relay (< 100 h/mes) | **≈ $18/mes** | ≈ **$46/mes** |
| `t4g.small`, 200 h/mes relayadas | **≈ $36/mes** | ≈ **$64/mes** |
| `t4g.medium`, 200 h/mes relayadas | **≈ $48/mes** | ≈ **$76/mes** |

### Con qué se compara

- **`meet.midulabs.com`** (el default, servidor del legacy): **$0**, pero es
  ajeno, **anónimo** y con datos de pacientes encima. El nombre de sala aleatorio
  ES la llave.
- **Jitsi propio**: ~$18–36/mes y además prende el JWT que la API ya firma
  (`isJitsiSecured()`), así que la sala pasa a tener puerta.
- **8x8 JaaS** (Jitsi gestionado): tier gratis chico y salto a ~$99/mes — número
  no verificado contra su pricing actual.

Apagar la caja fuera del horario del consultorio la deja en ~$3/mes de cómputo
(el EIP cobra los $3.65 igual, esté o no encendida) a cambio de ~40 s de arranque
en la primera consulta del día.

## Lo que se EVITA (ahorro del diseño)

| Recurso "normal" | Costo típico | Aquí |
| --- | ---: | --- |
| Application Load Balancer | ~$16–20/mes | ❌ Cloudflare Tunnel ($0) |
| NAT Gateway | ~$32/mes + datos | ❌ IP pública en la tarea ($3.6) |
| RDS Multi-AZ | 2× instancia | ❌ single-AZ (customs no lo requieren) |

## Regla para cotizar

- **Piso de infra por custom: ~$20–30/mes** (redondea a **$30**). Con Jitsi
  propio, **~$50** (redondea a **$60** si el cliente hace mucha teleconsulta).
- Es casi todo **fijo** (no escala con tráfico salvo el egress y algún burst de Fargate).
- **Compartido / one-time ≈ $0**: se reusa la cuenta AWS y Cloudflare free; el
  estado de Terraform vive en un bucket S3 compartido.
- Si el cliente necesita más (Multi-AZ, más CPU, Redis, workers), cada pieza se
  suma por separado — el módulo Terraform lo hace explícito.

## Ajustes de costo (palancas)

- **Aún más barato (~$8/mes):** Postgres corriendo en la misma tarea Fargate o en
  un EC2 `t4g.nano` — se pierde el managed/backup automático de RDS.
- **Más robusto:** RDS Multi-AZ (+100% RDS) y 2ª tarea Fargate para HA (+Fargate).
- **Reserved/Savings Plan** a 1 año baja RDS y Fargate ~30–40%.
