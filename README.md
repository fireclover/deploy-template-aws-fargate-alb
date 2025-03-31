# deploy-template-aws-fargate-alb

Use `npm run cdk deploy -- -c attribute=value` or **cdk.context.json** to set the neccessary context attributes.

### Example
```
{
  "dbType": "postgres",
  "dbName": "gitea",
  "dbUser": "gitea",
  "dbEnvMap": {
    "GITEA__database__USER": "DB_USER",
    "GITEA__database__DB_TYPE": "DB_TYPE",
    "GITEA__database__NAME": "DB_NAME",
    "GITEA__database__HOST": "DB_HOST",
    "GITEA__database__PORT": "DB_PORT"
  },
  "dbSecretsMap": {
    "GITEA__database__PASSWD": "DB_PASSWD"
  },
  "environment": {
    "GITEA_ADMIN_USERNAME": "kim",
    "GITEA_ADMIN_EMAIL": "kim@fireclover.cloud"
  },
  "secrets": {
    "GITEA_ADMIN_PASSWORD": ""
  },
  "printSecrets": false,
  "volumeMounts": { "giteaData": "/data" },
  "serviceName": "gitea",
  "containerPort": 3000,
  "memory": 1024,
  "cpu": 512,
  "registryCredentials": "arn:aws:secretsmanager:us-east-1:243729829223:secret:ghcr.io-JoGypq",
  "domain": "fireclover.aws.fireclover.cloud",
  "accountId": 243729829223,
  "containerImage": "ghcr.io/fireclover/gitea:dev"
}
```

When using `db` attributes a Database is created and connected securely automatically.

When using `volumeMounts` new EFS encrypted volumes will be created and mounted into containers automatically. EFS will automatically handle backups and rotation to slower/cheaper storage for infrequently used files.