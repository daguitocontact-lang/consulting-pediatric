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

## Lo que se EVITA (ahorro del diseño)

| Recurso "normal" | Costo típico | Aquí |
| --- | ---: | --- |
| Application Load Balancer | ~$16–20/mes | ❌ Cloudflare Tunnel ($0) |
| NAT Gateway | ~$32/mes + datos | ❌ IP pública en la tarea ($3.6) |
| RDS Multi-AZ | 2× instancia | ❌ single-AZ (customs no lo requieren) |

## Regla para cotizar

- **Piso de infra por custom: ~$20–30/mes** (redondea a **$30**).
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
