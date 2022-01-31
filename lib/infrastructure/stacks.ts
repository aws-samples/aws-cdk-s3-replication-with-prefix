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

export interface DestinationBucketConfig {
    bucketArn: string,
    accountId: string
}

// import * as sqs from 'aws-cdk-lib/aws-sqs';
export interface S3SourceStackProps extends StackProps {
    stagingBucket: DestinationBucketConfig
    replicationRoleName: string
}

export interface S3DestinationStackProps extends StackProps {
    sourceAccount: string,
    sourceRoleName: string
    destinationPrefix: string

}

export class S3SourceStack extends Stack {
    constructor(scope: Construct, id: string, props: S3SourceStackProps) {
        super(scope, id, props);
        const sourceBucket = new Bucket(this, "source-bucket", {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            versioned: true

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
        const replicationRole = new Role(this, "replication-role", {
            roleName: props.replicationRoleName,
            assumedBy: new ServicePrincipal("s3.amazonaws.com")
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
        replicationRole.addToPolicy(bucketReplicationPolicyStatement)
        replicationRole.addToPolicy(objectReplicationPolicyStatement)
        replicationRole.addToPolicy(destinationPolicyStatement)
        new CfnOutput(this, "source-bucket-output", {
            description: "source-bucket-name",
            value: sourceBucket.bucketName
        })

    }
}

export class S3DestinationStack extends Stack {
    readonly stagingBucketArn: string

    constructor(scope: Construct, id: string, props: S3DestinationStackProps) {
        super(scope, id, props);
        const stagingBucket = new Bucket(this, "staging-bucket", {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            bucketName: PhysicalName.GENERATE_IF_NEEDED,
            versioned: true,
            objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,

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
        })
        const visibilityTimeout = 60 * 6
        const stagingBucketEventQueue = new Queue(this, 'staging-bucket-event-queue', {
            visibilityTimeout: Duration.seconds(visibilityTimeout)
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
            runtime: Runtime.NODEJS_14_X,
            handler: "lambdaHandler",
            entry: path.join(__dirname, `../runtime/functions/moveObjectsLambda.ts`),
            environment: {
                DESTINATION_BUCKET_NAME: destinationBucket.bucketName,
                DESTINATION_PREFIX: props.destinationPrefix
            },
            tracing: Tracing.DISABLED,

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

    }
}
