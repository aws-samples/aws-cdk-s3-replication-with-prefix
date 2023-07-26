/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import {CfnOutput, Duration, PhysicalName, RemovalPolicy, Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {BlockPublicAccess, Bucket, CfnBucket, EventType, ObjectOwnership} from "aws-cdk-lib/aws-s3";
import {AccountPrincipal, ArnPrincipal, Effect, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {Queue} from "aws-cdk-lib/aws-sqs";
import {SqsDestination} from "aws-cdk-lib/aws-s3-notifications";
import {NodejsFunction} from "aws-cdk-lib/aws-lambda-nodejs";
import {Runtime, Tracing} from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import {SqsEventSource} from "aws-cdk-lib/aws-lambda-event-sources";
import {NagSuppressions} from "cdk-nag";

export interface DestinationBucketConfig {
    bucketArn: string,
    accountId: string
}

// import * as sqs from 'aws-cdk-lib/aws-sqs';
export interface S3SourceStackProps extends StackProps {
    stagingBucket: DestinationBucketConfig
    replicationRoleArn: string
}

export interface S3DestinationStackProps extends StackProps {
    sourceAccount: string,
    sourceRoleName: string
    destinationKey: string

}

export class S3SourceReplicationRoleStack extends Stack{
    readonly roleArn:string
    constructor(scope: Construct, id: string,replicationRoleName: string, props?: StackProps) {
        super(scope, id, props);
        const replicationRole = new Role(this, "replication-role", {
            roleName: replicationRoleName,
            assumedBy: new ServicePrincipal("s3.amazonaws.com")
        })
        this.roleArn=replicationRole.roleArn
        new CfnOutput(this, "source-replication-role-arn-output", {
            description: "source-replication-role-arn",
            value: replicationRole.roleArn
        })

    }
}

export class S3SourceStack extends Stack {
    constructor(scope: Construct, id: string, props: S3SourceStackProps) {
        super(scope, id, props);
        const serverLogsBucket = new Bucket(this,"source-server-logs",{
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            enforceSSL: true
        })
        const sourceBucket = new Bucket(this, "source-bucket", {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            versioned: true,
            enforceSSL: true,
            serverAccessLogsBucket: serverLogsBucket,
            serverAccessLogsPrefix: "source"
        })
        const bucketReplicationPolicyStatement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["s3:GetReplicationConfiguration", "s3:ListBucket"],
            resources: [sourceBucket.bucketArn]
        })
        const objectReplicationPolicyStatement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["s3:GetObjectVersion",
                "s3:GetObjectVersionAcl",
                "s3:GetObjectVersionForReplication",
                "s3:GetObjectLegalHold",
                "s3:GetObjectVersionTagging",
                "s3:GetObjectRetention",

            ],
            resources: [sourceBucket.arnForObjects("*")]
        })
        const destinationPolicyStatement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "s3:ReplicateObject",
                "s3:ReplicateDelete",
                "s3:ReplicateTags",
                "s3:GetObjectVersionTagging",
                "s3:ObjectOwnerOverrideToBucketOwner"
            ],
            resources: [`${props.stagingBucket.bucketArn}/*`]
        })
        const replicationRole = Role.fromRoleArn(this,"replication-role",props.replicationRoleArn,{

            mutable: true
        })

        const cfnBucket = sourceBucket.node.defaultChild as CfnBucket
        cfnBucket.replicationConfiguration = {
            role: replicationRole.roleArn,
            rules: [{
                id: props.stagingBucket.bucketArn,
                destination: {
                    bucket: props.stagingBucket.bucketArn,
                    account: props.stagingBucket.accountId,
                    accessControlTranslation: {
                        owner: 'Destination'
                    },
                    replicationTime: {
                        status: 'Enabled',
                        time: {
                            minutes: 15
                        }
                    },
                    metrics: {
                        status: 'Enabled',
                        eventThreshold: {
                            minutes: 15
                        }
                    }
                },
                filter: {
                    prefix: ""
                },
                priority: 1,

                sourceSelectionCriteria: {
                    replicaModifications: {
                        status: "Enabled"
                    }
                },
                deleteMarkerReplication: {
                    status: "Enabled",
                },

                status: 'Enabled'

            }],

        }
        const role = replicationRole as Role
        role.addToPolicy(bucketReplicationPolicyStatement)
        role.addToPolicy(objectReplicationPolicyStatement)
        role.addToPolicy(destinationPolicyStatement)
        new CfnOutput(this, "source-bucket-output", {
            description: "source-bucket-name",
            value: sourceBucket.bucketName
        })
        NagSuppressions.addStackSuppressions(this,[
            {
                id:"AwsSolutions-IAM5",
                reason: "All wildcard permission are on purpose for the sample"
            }
        ])
    }
}

export class S3DestinationStack extends Stack {
    readonly stagingBucketArn: string

    constructor(scope: Construct, id: string, props: S3DestinationStackProps) {
        super(scope, id, props);
        const serverLogsBucket = new Bucket(this,"destination-server-logs",{
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            enforceSSL: true,
            autoDeleteObjects: true,
        })
        const stagingBucket = new Bucket(this, "staging-bucket", {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            bucketName: PhysicalName.GENERATE_IF_NEEDED,
            versioned: true,
            objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
            enforceSSL:true,
            serverAccessLogsBucket: serverLogsBucket,
            serverAccessLogsPrefix: "staging",
            autoDeleteObjects: true,

        })
        const sourcePrincipal: ArnPrincipal = new ArnPrincipal(`arn:aws:iam::${props.sourceAccount}:role/${props.sourceRoleName}`)
        stagingBucket.addToResourcePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            principals: [
                new ArnPrincipal(`arn:aws:iam::${props.sourceAccount}:role/${props.sourceRoleName}`)
            ],
            actions: [
                "s3:ReplicateDelete",
                "s3:ReplicateObject",
                "s3:ReplicateTags"
            ],
            resources: [stagingBucket.arnForObjects("*")]

        }))
        stagingBucket.addToResourcePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            principals: [
                new AccountPrincipal(props.sourceAccount)
            ],
            actions: [
                "s3:ObjectOwnerOverrideToBucketOwner"
            ],
            resources: [stagingBucket.arnForObjects("*")]

        }))
        stagingBucket.addToResourcePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            principals: [
                new ArnPrincipal(`arn:aws:iam::${props.sourceAccount}:role/${props.sourceRoleName}`)
            ],
            actions: [
                "s3:GetBucketVersioning",
                "s3:PutBucketVersioning"
            ],
            resources: [stagingBucket.bucketArn]

        }))

        this.stagingBucketArn = stagingBucket.bucketArn

        const destinationBucket = new Bucket(this, "destination-bucket", {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            versioned: true,
            enforceSSL: true,
            serverAccessLogsBucket: serverLogsBucket,
            serverAccessLogsPrefix: "destination",
            autoDeleteObjects: true,
        })
        const visibilityTimeout = 60 * 6
        const stagingBucketEventDLQ = new Queue(this, 'staging-bucket-event-queue-dlq', {
            enforceSSL:true
        });
        const stagingBucketEventQueue = new Queue(this, 'staging-bucket-event-queue', {
            visibilityTimeout: Duration.seconds(visibilityTimeout),
            deadLetterQueue: {
                queue: stagingBucketEventDLQ,
                maxReceiveCount: 3
            },
            enforceSSL:true
        });
        stagingBucket.addEventNotification(
            EventType.OBJECT_CREATED,
            new SqsDestination(stagingBucketEventQueue),
        );
        stagingBucket.addEventNotification(
            EventType.OBJECT_REMOVED,
            new SqsDestination(stagingBucketEventQueue),
        );
        const moveObjectsLambda = new NodejsFunction(this, "moveObjectsLambda", {
            memorySize: 128,
            timeout: Duration.seconds(visibilityTimeout / 6),
            runtime: Runtime.NODEJS_18_X,
            handler: "lambdaHandler",
            entry: path.join(__dirname, `../runtime/functions/moveObjectsLambda.ts`),
            environment: {
                DESTINATION_BUCKET_NAME: destinationBucket.bucketName,
                DESTINATION_KEY: props.destinationKey
            },
            tracing: Tracing.ACTIVE,

        });
        stagingBucketEventQueue.grant(moveObjectsLambda,
            "s3:DeleteMessage"
        )
        moveObjectsLambda.addEventSource(new SqsEventSource(stagingBucketEventQueue, {
            batchSize: 10,
            enabled: true,
            reportBatchItemFailures: true
        }))
        stagingBucket.grantReadWrite(moveObjectsLambda)

        destinationBucket.grantReadWrite(moveObjectsLambda)
        moveObjectsLambda.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "s3:GetObjectVersion",
                "s3:GetBucketVersioning",
                "s3:GetObjectTagging",
                "s3:GetObjectVersionTagging",
                "s3:PutObjectTagging",
                "s3:PutObjectVersionTagging"
            ],
            resources: [stagingBucket.arnForObjects("*")]
        }))
        moveObjectsLambda.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "s3:GetObjectVersion",
                "s3:GetBucketVersioning",
                "s3:GetObjectTagging",
                "s3:GetObjectVersionTagging",
                "s3:PutObjectTagging",
                "s3:PutObjectVersionTagging"
            ],
            resources: [destinationBucket.arnForObjects("*")]
        }))
        new CfnOutput(this, "staging-bucket-name", {
            description: "staging-bucket-name",
            value: stagingBucket.bucketName,
            exportName: `${id}::staging-bucket-name`
        })
        new CfnOutput(this, "destination-bucket-name", {
            description: "destination-bucket-name",
            value: stagingBucket.bucketName

        })
        NagSuppressions.addStackSuppressions(this,[
            {
                id:"AwsSolutions-IAM4",
                reason: "AWS Managed Policies allowed for aws-samples"
            }
        ])
        NagSuppressions.addStackSuppressions(this,[
            {
                id:"AwsSolutions-IAM5",
                reason: "All wildcard permission are on purpose for the sample"
            }
        ])
    }
}
