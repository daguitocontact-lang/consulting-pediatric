# Reuse Daguito's shared TF state bucket, one key per custom under customs/<client>/.
terraform {
  backend "s3" {
    bucket  = "daguito-tf-state-322056173639"
    key     = "customs/pediatric/prod.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}
