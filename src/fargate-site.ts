#!/usr/bin/env node
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
// import { AlbToFargate } from '@aws-solutions-constructs/aws-alb-fargate';
import { CfnOutput, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { IVpc, Peer, Port, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { 
  // ApplicationListenerRule, 
  ApplicationLoadBalancer, 
  ApplicationProtocol, 
  ListenerAction 
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
//import * as path from 'path';

export interface FargateSiteProps {
  domainName: string;
  siteSubDomain: string;
  containerImage: string;
  registryCredentials: string;
  containerPort: string;
  scale: number;
  memory: number;
  cpu: number;
  secrets: { [key: string]: secretsmanager.Secret; };
  environment: { [key: string]: string; };
  region: string;
  vpc: IVpc;
  printSecrets: boolean;
  volumeMounts: { [key: string]: string; };
}

/**
 * Static site infrastructure, which deploys site content to an S3 bucket.
 *
 * The site redirects from HTTP to HTTPS, using a CloudFront distribution,
 * Route53 alias record, and ACM certificate.
 */
export class FargateSite extends Construct {
  constructor(parent: Stack, name: string, props: FargateSiteProps) {
    super(parent, name);

    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.domainName });
    const subDomain = props.siteSubDomain;
    const siteDomain = subDomain + '.' + props.domainName;
    const registryCredentials = props.registryCredentials;
    const containerImage = props.containerImage;
    const containerPort = parseInt(props.containerPort);
    const cpu = props.cpu;
    const memory = props.memory;
    const scale = props.scale;
    const environment = props.environment;
    const secrets: { [key: string]: ecs.Secret; } = {};
    const printSecrets = props.printSecrets || false;

    // const region = props.region;

    // Using default vpc, but should likely be using private subnets in new vpc 
    const vpc = props.vpc;
    const secretArns = [];
    for (const [key, value] of Object.entries(props.secrets)) { 
      secrets[key] = ecs.Secret.fromSecretsManager(value, 'password');
      secretArns.push(value.secretArn);
    };
    if (printSecrets) {
      for (const [key, value] of Object.entries(props.secrets)) { new CfnOutput(this, key, { value: value.secretValue.unsafeUnwrap() });}
    }

    new CfnOutput(this, 'ENVs', { value: JSON.stringify(environment, undefined, 1) });
    new CfnOutput(this, 'Site', { value: 'https://' + siteDomain });


    // TLS certificate
    const certificate = new acm.Certificate(this, 'Certificate-'+siteDomain, {
      domainName: siteDomain,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    new CfnOutput(this, 'Certificate', { value: certificate.certificateArn });

    // Container Image
    const imgProps: ecs.RepositoryImageProps = registryCredentials ? {
      credentials: secretsmanager.Secret.fromSecretCompleteArn(this, 'Secret', registryCredentials)
    } : {};
    
    new CfnOutput(this, 'Image', { value: props.containerImage });

    
    // IAM Roles for ECS Execution and Task IAM
    const executionRole = new Role(this, 'ExecutionRole-' + subDomain, {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ],      
    });
    if (registryCredentials) executionRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [registryCredentials],
        actions: [            
          'secretsmanager:GetSecretValue',
          'secretsmanager:DescribeSecret',
        ]
      })
    );
    const taskRole = new Role(this, 'TaskRole-' + subDomain, {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    if (secretArns) taskRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        // resources: ['*'],
        resources: secretArns,
        actions: [            
          'secretsmanager:GetSecretValue',
          'secretsmanager:DescribeSecret',
        ]
      })
    );
    
    // Tasks and ALB security groups
    const tasksSecurityGroup = new SecurityGroup(this, 'TaskSecurityGroup', 
      { 
        securityGroupName: props.siteSubDomain + 'TaskSecurityGroup', 
        vpc, 
        allowAllOutbound: true, 
      });
    tasksSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(containerPort));
    const albSecurityGroup = new SecurityGroup(this, 'ALBSecurityGroup', 
      { 
        securityGroupName: props.siteSubDomain + 'ALBSecurityGroup', 
        vpc, 
        allowAllOutbound: true, 
      });
    albSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.HTTP);    
    albSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.HTTPS);    

    // Create the ALB with HTTP to HTTPS redirect and listeners
    const alb = new ApplicationLoadBalancer(this, 'ALB', {
      loadBalancerName: subDomain + 'ALB',
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    alb.addListener('HTTP', { port: 80, protocol: ApplicationProtocol.HTTP, defaultAction: ListenerAction.redirect({protocol: 'HTTPS', permanent: true}) });
    const httpsListener = alb.addListener('HTTPS', { port: 443, protocol: ApplicationProtocol.HTTPS, certificates: [certificate] });

    // Create the ECS cluster
    const cluster = new ecs.Cluster(this, 'Cluster', { 
      clusterName: subDomain + 'Cluster',  
      containerInsights: false,
      enableFargateCapacityProviders: true,
      vpc,
    });

    // Create EFS filesystems and ECS Volume mounts
    const volumes: ecs.Volume[] = [];
    const fileSystems = Object.keys(props.volumeMounts).map((key) => {
      const fileSystem = new efs.FileSystem(this, 'EfsFileSystem-'+key, {
        fileSystemName: key,
        vpc: vpc,
        encrypted: true,
        lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
        performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
        throughputMode: efs.ThroughputMode.BURSTING
      });

      fileSystem.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ['elasticfilesystem:ClientMount'],
          principals: [new iam.AnyPrincipal()],
          conditions: {
            Bool: {
              'elasticfilesystem:AccessedViaMountTarget': 'true'
            }
          }
        })
      )
      volumes.push({
        name: key,
        efsVolumeConfiguration: {
            fileSystemId: fileSystem.fileSystemId,
        }
      });
      return fileSystem;
    });

    // Createthe ECS Task Definition and child Container Definition
    const fargateTaskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
        memoryLimitMiB: memory,
        cpu: cpu,
        executionRole,
        taskRole,
        volumes,
      });
    
    const containerDef = new ecs.ContainerDefinition(this, "ContainerDef", {
      containerName: 'web',
      image: ecs.ContainerImage.fromRegistry(containerImage, imgProps),
      taskDefinition: fargateTaskDefinition,
      environment,
      secrets,
      portMappings: [{ containerPort }]
    });

    for (const [key, value] of Object.entries(props.volumeMounts)) {
      containerDef.addMountPoints(
        {
          sourceVolume: key,
          containerPath: value,
          readOnly: false
        }
      );
    };

    // Setup the ECS Service
    const service = new ecs.FargateService(this, subDomain + 'Service', 
      { 
        serviceName: subDomain,
        cluster, 
        taskDefinition: fargateTaskDefinition,
        minHealthyPercent: 100,
        securityGroups: [tasksSecurityGroup],
        desiredCount: scale,
        assignPublicIp: true,
        enableExecuteCommand: true,
      });
    service.registerLoadBalancerTargets(
      {
        containerName: 'web',
        containerPort: containerPort,
        protocol: ecs.Protocol.TCP,
        newTargetGroupId: subDomain + 'ECS',
        listener: ecs.ListenerConfig.applicationListener(httpsListener, {
          protocol: ApplicationProtocol.HTTP,
          healthCheck: {
            path: '/', 
          }
        }),
      },
    );

    // Allow access to EFS from Fargate ECS
    fileSystems.every((fileSystem) => {
      fileSystem.grantRootAccess(taskRole.grantPrincipal);
      fileSystem.connections.allowDefaultPortFrom(service.connections);
    });

    // Route53 alias record for the ALB
    new route53.ARecord(this, 'SiteAliasRecord', {
      recordName: siteDomain,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
      zone
    });


  }
}
