#!/usr/bin/env node
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


import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {S3SourceStack, S3DestinationStack, S3SourceReplicationRoleStack} from '../lib/infrastructure/stacks';
import {Aspects, PhysicalName} from "aws-cdk-lib";
import {Configuration} from "aws-cdk/lib/settings";
import {AwsSolutionsChecks, NagSuppressions} from "cdk-nag";

const app = new cdk.App();



const destinationAccount=app.node.tryGetContext("destinationAccount")
const destinationRegion=app.node.tryGetContext("destinationRegion")
const destinationPrefix=app.node.tryGetContext("destinationKey")
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
    destinationKey: destinationPrefix
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

Aspects.of(app).add(new AwsSolutionsChecks())
