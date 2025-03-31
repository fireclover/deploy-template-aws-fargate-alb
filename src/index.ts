#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { FargateSite } from './fargate-site';
import { Postgres } from './postgres';

/**
 * This stack relies on getting the domain name from CDK context.
 * Use 'cdk synth -c domain=mystaticsite.com -c subdomain=www'
 * Or add the following to cdk.json:
 * {
 *   "context": {
 *     "domain": "mystaticsite.com",
 *     "subdomain": "www",
 *     "accountId": "1234567890",
 *     "containerImage": "docker.io/image1:latest",
 *   }
 * }
**/
class FargateStack extends cdk.Stack {
    constructor(parent: cdk.App, name: string, props: cdk.StackProps) {
        super(parent, name, props);

        const serviceName = this.node.tryGetContext('serviceName') || this.node.tryGetContext('subdomain') || 'fargateapp';
        const username = this.node.tryGetContext('dbUser') || serviceName;
        const databaseName = this.node.tryGetContext('dbName') || serviceName;


        // Using default vpc, but should likely be using private subnets in new vpc 
        const region = this.node.tryGetContext('region') || 'us-east-1';
        // const vpc = cdk.aws_ec2.Vpc.fromLookup(this, 'DefaultVpc', {isDefault: true, region });
        // const vpc = cdk.aws_ec2.Vpc
        const vpc = new cdk.aws_ec2.Vpc(this, serviceName + 'Vpc');


        const environment = this.node.tryGetContext('env') || {};
        const secrets = this.node.tryGetContext('secrets') || {};
        const dbEnvMap = this.node.tryGetContext('dbEnvMap') || {};
        const dbSecretsMap = this.node.tryGetContext('dbSecretsMap') || {};
        
        const dbType = this.node.tryGetContext('dbType');
        if (dbType == 'postgres') {            
            const postgres = new Postgres(this, serviceName + 'Postgres', { vpc, username, databaseName });
            const dbSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'DbSecret', postgres.secretArn);

            // Default envs and secrets for DB
            environment['DB_HOST'] = postgres.host;
            environment['DB_PORT'] = postgres.port;
            environment['DB_NAME'] = postgres.databaseName;
            environment['DB_USER'] = postgres.username;
            environment['DB_TYPE'] = dbType;
            secrets['DB_PASSWD'] = dbSecret;

            // environment['GITEA__database__USER'] = postgres.username
            // environment['GITEA__database__DB_TYPE'] = dbType;
            // environment['GITEA__database__NAME'] = postgres.databaseName;
            // environment['GITEA__database__HOST'] = postgres.host;
            // secrets['GITEA__database__PASSWD'] = dbSecret;        

            // environment['GITEA_ADMIN_USERNAME'] = 'kim';
            // environment['GITEA_ADMIN_EMAIL'] = 'kim@fireclover.cloud';

            // secrets['GITEA_ADMIN_PASSWORD'] = dbSecret;
        }
        const generateSecret = (template: object, generateStringKey = 'password', excludeCharacters = '/@":') => { 
            return { secretStringTemplate: JSON.stringify(template), generateStringKey, excludeCharacters };
        };
        if (secrets) {
            Object.keys(secrets).every((key: string) => { 
                secrets[key] = secrets[key] 
                    ? typeof(secrets[key]) == 'string' 
                        ? secretsmanager.Secret.fromSecretCompleteArn(this, key, secrets[key])
                        : new secretsmanager.Secret(this, key, { generateSecretString: generateSecret(secrets[key]) })
                    : new secretsmanager.Secret(this, key, { generateSecretString: generateSecret({}) }) 
            });
        }

        if (dbEnvMap) for (const [key, value] of Object.entries(dbEnvMap)) { environment[key] = environment[`${value}`] };
        if (dbSecretsMap) for (const [key, value] of Object.entries(dbSecretsMap)) { secrets[key] = secrets[`${value}`] };
        
        new FargateSite(this, serviceName, {
            vpc,
            region,            
            domainName: this.node.tryGetContext('domain'),
            siteSubDomain: this.node.tryGetContext('subdomain'),
            registryCredentials: this.node.tryGetContext('registryCredentials'),
            containerImage: this.node.tryGetContext('containerImage'),
            containerPort: this.node.tryGetContext('containerPort') || '80',
            environment,
            secrets,
            printSecrets: this.node.tryGetContext('printSecrets') || false,
            memory: this.node.tryGetContext('memory') || 512,
            cpu: this.node.tryGetContext('cpu') || 256,
            scale: this.node.tryGetContext('scale') || 1,
            volumeMounts: this.node.tryGetContext('volumeMounts') || {},
        });
    }
}

const app = new cdk.App();

new FargateStack(app, `FargateSite-${app.node.tryGetContext('subdomain')}`, {
    /**
     * This is required for our use of hosted-zone lookup.
     *
     * Lookups do not work at all without an explicit environment
     * specified; to use them, you must specify env.
     * @see https://docs.aws.amazon.com/cdk/latest/guide/environments.html
     */
    env: {
        account: app.node.tryGetContext('accountId').toString(),
        /**
         * Stack must be in us-east-1, because the ACM certificate for a
         * global CloudFront distribution must be requested in us-east-1.
         */
        region: app.node.tryGetContext('region') || 'us-east-1',
    }
});

app.synth();
