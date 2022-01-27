#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { S3SourceStack,S3DestinationStack } from '../lib/infrastructure/stacks';
import {PhysicalName} from "aws-cdk-lib";

const app = new cdk.App();
const replicationRoleName="aws-cdk-s3-replication-with-prefix-role"
const destinationStack=new S3DestinationStack(app, 'aws-cdk-s3-replication-with-prefix-destination-stack', {
    env:{
        account: "562200247894",
        region: "us-east-2"
    },
    sourceRoleName: replicationRoleName,
    sourceAccount: "149451982790"
});

new S3SourceStack(app, 'aws-cdk-s3-replication-with-prefix-source-stack', {
    env:{
        account: "149451982790",
        region: "us-east-2"
    },
    stagingBucket: {
        bucketArn:destinationStack.stagingBucketArn,
        accountId:destinationStack.account
    },
    replicationRoleName: replicationRoleName
});
