#!/usr/bin/env node
import * as rds from 'aws-cdk-lib/aws-rds';
// import { AlbToFargate } from '@aws-solutions-constructs/aws-alb-fargate';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cdk from 'aws-cdk-lib';


export interface PostgresProps {
  vpc: ec2.IVpc;
  port?: number;
  username: string;
  databaseName: string;

//   serviceName: string;
//   siteSubDomain: string;

//   domainName: string;
//   containerImage: string;
//   registryCredentials: string;
//   containerPort: string;
//   scale: number;
//   memory: number;
//   cpu: number;
//   environment: { [key: string]: string; };
//   region: string;
}

/**
 * Static site infrastructure, which deploys site content to an S3 bucket.
 *
 * The site redirects from HTTP to HTTPS, using a CloudFront distribution,
 * Route53 alias record, and ACM certificate.
 */
export class Postgres extends Construct {
    public host: string;
    public port: number;
    public username: string;
    public databaseName: string;
    public secretArn: string;

  constructor(parent: Stack, name: string, props: PostgresProps) {
    super(parent, name);

    const port = props.port || 5432;
    const vpc = props.vpc;
    const username = props.username;
    const databaseName = props.databaseName;

    // const subDomain = props.siteSubDomain;
    // const serviceName = props.serviceName;

    // const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.domainName });
    // const siteDomain = subDomain + '.' + props.domainName;
    // const registryCredentials = props.registryCredentials;
    // const containerImage = props.containerImage;
    // const containerPort = parseInt(props.containerPort);
    // const cpu = props.cpu;
    // const memory = props.memory;
    // const scale = props.scale;
    // const environment = props.environment;
    // const region = props.region;

    // Create the serverless cluster, provide all values needed to customise the database.
    // const cluster = new rds.ServerlessCluster(this, serviceName + 'AuroraCluster', {
    // engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
    // vpc,
    // credentials: { username: serviceName },
    // clusterIdentifier: 'db-' + serviceName,
    // defaultDatabaseName: 'serviceName',
    // });




    // // TLS certificate
    // const certificate = new acm.Certificate(this, 'SiteCertificate', {
    //   domainName: siteDomain,
    //   validation: acm.CertificateValidation.fromDns(zone),
    // });

    // const taskRole = new Role(this, 'TaskRole-' + siteDomain, {
    //   assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    // });
    // taskRole.addToPolicy(
    //   new PolicyStatement({
    //     effect: Effect.ALLOW,
    //     resources: ['*'],
    //     // resources: [registryCredentials],
    //     actions: [            
    //       'secretsmanager:GetSecretValue',
    //       'secretsmanager:DescribeSecret',
    //     ]
    //   })
    // );
    
    // // Tasks and ALB security groups
    // const tasksSecurityGroup = new SecurityGroup(this, 'TaskSecurityGroup', 
    //   { 
    //     securityGroupName: props.siteSubDomain + 'TaskSecurityGroup', 
    //     vpc, 
    //     allowAllOutbound: true, 
    //   });
    // tasksSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(containerPort));
    

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
        vpc,
        description: 'Allow postgresql access to db',
        allowAllOutbound: true,   // Can be set to false
    });
    dbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), 'allow PostgreSQL access');


    // create a db cluster
    // https://github.com/aws/aws-cdk/issues/20197#issuecomment-1117555047
    const dbCluster = new rds.DatabaseCluster(this, 'DbCluster', {
    engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_6,
    }),
    defaultDatabaseName: databaseName,
    credentials: rds.Credentials.fromGeneratedSecret(username, { secretName: databaseName+'-'+username+'-credentials' }),
    instances: 1,
    instanceProps: {
        vpc: vpc,
        instanceType: new ec2.InstanceType('serverless'),
        autoMinorVersionUpgrade: true,
        publiclyAccessible: true,
        securityGroups: [dbSecurityGroup],
        vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC, // use the public subnet created above for the db
        }),
    },
    // readers: [{
    //     bind: function (scope: Construct, cluster: rds.IDatabaseCluster, options: rds.ClusterInstanceBindOptions): rds.IAuroraClusterInstance {
    //         throw new Error('Function not implemented.');
    //     }
    // }],
    port, // use port 5432 instead of 3306
    })

    // add capacity to the db cluster to enable scaling
    cdk.Aspects.of(dbCluster).add({
        visit(node) {
            if (node instanceof rds.CfnDBCluster) {
                node.serverlessV2ScalingConfiguration = {
                    minCapacity: 0.5, // min capacity is 0.5 vCPU
                    maxCapacity: 1, // max capacity is 1 vCPU (default)
                }
            }
        },
    })
  
    this.secretArn = dbCluster.secret?.secretArn ?? '';
    this.host = dbCluster.clusterEndpoint.hostname;
    this.port = dbCluster.clusterEndpoint.port;
    this.databaseName = databaseName;
    this.username = username;
    
  }
}
