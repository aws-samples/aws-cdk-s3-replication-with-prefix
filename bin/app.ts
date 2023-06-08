#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {S3SourceStack, S3DestinationStack, S3SourceReplicationRoleStack} from '../lib/infrastructure/stacks';
import {PhysicalName} from "aws-cdk-lib";
import {Configuration} from "aws-cdk/lib/settings";

const app = new cdk.App();



const destinationAccount=app.node.tryGetContext("destinationAccount")
const destinationRegion=app.node.tryGetContext("destinationRegion")
const destinationPrefix=app.node.tryGetContext("destinationPrefix")
const sourceAccount=app.node.tryGetContext("sourceAccount")
const sourceRegion=app.node.tryGetContext("sourceRegion")

if (destinationAccount == null || destinationRegion == null || destinationAccount == null || destinationRegion == null || destinationPrefix==null ) {
    throw Error("You must specify source account, source region, destination account, destination region, and destination prefix via cdk context (-c sourceAccount=<sourceAccount> -c sourceRegion=<sourceRegion> -c destinationAccount=<destinationAccount> -c destinationRegion=<destinationRegion> -c -c destinationPrefix=<destinationPrefix>)")
}


const replicationRoleName="aws-cdk-s3-replication-with-prefix-role"
const replicationRoleStack=new S3SourceReplicationRoleStack(app,"aws-cdk-s3-replication-with-prefix-source-replication-role-stack",replicationRoleName,{
    env: {
        account: sourceAccount,
        region: sourceRegion
    }
})

const destinationStack=new S3DestinationStack(app, 'aws-cdk-s3-replication-with-prefix-destination-stack', {
    env: {
        account: destinationAccount,
        region: destinationRegion
    },
    sourceRoleName: replicationRoleName,
    sourceAccount: sourceAccount,
    destinationPrefix: destinationPrefix
});

new S3SourceStack(app, 'aws-cdk-s3-replication-with-prefix-source-stack', {
    env:{
        account: sourceAccount,
        region: sourceRegion
    },
    stagingBucket: {
        bucketArn:destinationStack.stagingBucketArn,
        accountId:destinationAccount
    },
    replicationRoleArn: replicationRoleStack.roleArn
});
