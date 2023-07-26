// import * as cdk from 'aws-cdk-lib';
// import { Template } from 'aws-cdk-lib/assertions';
// import * as AwsCdkS3ReplicationWithPrefix from '../lib/aws-cdk-s3-replication-with-prefix-stack';

// example test. To run these tests, uncomment this file along with the
// example resource in lib/aws-cdk-s3-replication-with-prefix-stack.ts
import {getKeyMapping, lambdaHandler} from "../lib/runtime/functions/moveObjectsLambda";

const OLD_ENV = process.env;

beforeEach(() => {
	jest.resetModules() // Most important - it clears the cache
	process.env = { ...OLD_ENV }; // Make a copy
});

afterAll(() => {
	process.env = OLD_ENV; // Restore old environment
});
test.skip('Test dynamic date', async () => {
	process.env.DESTINATION_PREFIX = 'date=${date}';
	process.env.DESTINATION_BUCKET_NAME = 'aws-cdk-s3-replication-w-destinationbucketd513604-72g9ry82l0o2';

const event={

	"Records": [
		{
			"messageId": "5d3fe27e-aac2-4aa7-bf60-0b8422d04dd9",
			"receiptHandle": "AQEBnBT246d01wBsPZYBAGuAPsXyC+o6GSvjI9WzXSi6LPmdtxiXs8MsLY838WJCMEFK1VcyJmYVvj/qQm91C5wmlFJG19BL7rAJ22p5OZ1L8x28VijvKfDhnJ0pQi81HKVWCV6LCOZ/MAagGrI3kAJbvNspgbRGEENGHSlNALQDsjMiNFWXNKymJ+IAFLvDYSunR9T2dkZKJ+WJmhmpDDk5jPDk+wJF/nvHKmmZEJ98m6s+/yRT3ik3DdkbLJgEhmDF7PeLTf5U3HAiK2h7CX/JtvP9oAZhr/pXYCHyOekmQDhRlKIwZNnmuEv2dTn4pVGv9SGmpJOtiEl7HJzA+Tys0PpZPzlpPXfe2VOc3lDD/WIxp957qEA1nhyOlkALj/lDiJ8x8VigC7PzkVzMRTl1LNxH9Un9DosIyIMMCDwA9/5bX0WvHcvn9KsnhGec7/gS6BOTsluY7sXpOadmk4dGxGfMQNIHLc5L1exw4cgXz0U=",
			"body": "{\"Records\":[{\"eventVersion\":\"2.1\",\"eventSource\":\"aws:s3\",\"awsRegion\":\"us-east-1\",\"eventTime\":\"2023-07-24T15:07:43.116Z\",\"eventName\":\"ObjectCreated:Put\",\"userIdentity\":{\"principalId\":\"AWS:AROAS5S37JUNW2YZMHWXJ:s3-replication\"},\"requestParameters\":{\"sourceIPAddress\":\"3.22.166.30\"},\"responseElements\":{\"x-amz-request-id\":\"5KE88CB4G13G0D1X\",\"x-amz-id-2\":\"Y7VeIkwzUmQrCVFaoLfWTtRWBrobRSpAtUeBvZYZLb0zla57x4ObR5fIeAaavkiLiZOYtd46/9R04WAp9bDV2mXK/VjTb3i5\"},\"s3\":{\"s3SchemaVersion\":\"1.0\",\"configurationId\":\"ODhkMTA2M2EtN2NlNS00MDUxLTljMjYtN2U4NzBlOTMxNTM5\",\"bucket\":{\"name\":\"aws-cdk-s3-replication-wiackstagingbuckete0fa8810b2c5bdd9517c\",\"ownerIdentity\":{\"principalId\":\"A39477JFO5VRDK\"},\"arn\":\"arn:aws:s3:::aws-cdk-s3-replication-wiackstagingbuckete0fa8810b2c5bdd9517c\"},\"object\":{\"key\":\"aws.test.ts\",\"size\":0,\"eTag\":\"d41d8cd98f00b204e9800998ecf8427e\",\"versionId\":\"1BcZ.nMFgFqbqMHOALqVotZze01QFuDu\",\"sequencer\":\"0064BE93A7383AFF0C\"}}}]}",
			"attributes": {
				"ApproximateReceiveCount": "1",
				"SentTimestamp": "1690211263822",
				"SenderId": "AIDAJHIPRHEMV73VRJEBU",
				"ApproximateFirstReceiveTimestamp": "1690211263827"
			},
			"messageAttributes": {},
			"md5OfBody": "7a805e3cf2e9ddb9ef1583fbb624763e",
			"eventSource": "aws:sqs",
			"eventSourceARN": "arn:aws:sqs:us-east-1:1234567890:aws-cdk-s3-replication-with-prefix--stagingbucketeventqueue3E13452E-Rs8zENIS5rz3",
			"awsRegion": "us-east-1"
		}
	]
}
//@ts-ignore
await lambdaHandler(event,{})

});


test('Test getKeyMapping', async () => {
	let mapping=getKeyMapping('d=${date}',"AWS:ComplianceItem/accountid=123456789012/region=us-east-2/resourcetype=ManagedInstanceInventory/i-00620f2f8c6de45ff.json")
	expect(mapping).toEqual(`d=${new Date().toISOString().split('T')[0]}/AWS:ComplianceItem/accountid=123456789012/region=us-east-2/resourcetype=ManagedInstanceInventory/i-00620f2f8c6de45ff.json`)
	mapping=getKeyMapping('d=${date}:prefix',"AWS:ComplianceItem/accountid=123456789012/region=us-east-2/resourcetype=ManagedInstanceInventory/i-00620f2f8c6de45ff.json")
	expect(mapping).toEqual(`d=${new Date().toISOString().split('T')[0]}/AWS:ComplianceItem/accountid=123456789012/region=us-east-2/resourcetype=ManagedInstanceInventory/i-00620f2f8c6de45ff.json`)
	mapping=getKeyMapping('d=${date}:suffix',"AWS:ComplianceItem/accountid=123456789012/region=us-east-2/resourcetype=ManagedInstanceInventory/i-00620f2f8c6de45ff.json")
	expect(mapping).toEqual(`AWS:ComplianceItem/accountid=123456789012/region=us-east-2/resourcetype=ManagedInstanceInventory/d=${new Date().toISOString().split('T')[0]}/i-00620f2f8c6de45ff.json`)
	mapping=getKeyMapping(`[{"oldPath":"^AWS:ComplianceItem/(.*)/(.*.json)$","newPath":"d=\${date}/AWS:ComplianceItem/$2"}]`,"AWS:ComplianceItem/accountid=123456789012/region=us-east-2/resourcetype=ManagedInstanceInventory/i-00620f2f8c6de45ff.json")
	expect(mapping).toEqual(`d=${new Date().toISOString().split('T')[0]}/AWS:ComplianceItem/i-00620f2f8c6de45ff.json`)
	mapping=getKeyMapping('[{"oldPath":"AWS:(ComplianceItem|ComplianceSummary|InstanceInformation)\/.*\/(.*\.json)","newPath":"inventory/AWS:$1/d=${date}/$2"}]',"AWS:ComplianceItem/accountid=123456789012/region=us-east-2/resourcetype=ManagedInstanceInventory/i-00620f2f8c6de45ff.json")
	expect(mapping).toEqual(`inventory/AWS:ComplianceItem/d=${new Date().toISOString().split('T')[0]}/i-00620f2f8c6de45ff.json`)
})