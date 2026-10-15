variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "vpc_connector_id" {
  type = string
}

variable "db_connection_name" {
  type = string
}

variable "secrets" {
  type = map(string)
}

variable "bucket_name" {
  type = string
}

variable "domain" {
  type = string
}

variable "admin_origin" {
  type = string
}
