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

import {Context, S3Event, S3EventRecord, SQSEvent, SQSRecord} from "aws-lambda";
import {
	CopyObjectCommand,
	DeleteObjectCommand,
	S3Client,
	CopyObjectCommandOutput, PutObjectCommand, PutObjectTaggingCommand, GetObjectTaggingCommand, Tag
} from "@aws-sdk/client-s3";
import {DeleteMessageCommand, SQSClient} from "@aws-sdk/client-sqs";
import * as arn from "@aws-sdk/util-arn-parser";

const s3Client = new S3Client({});
const sqsClient = new SQSClient({})

interface MoveResponse {
	bucket: string
	key: string,
	versionId?: string,
	success: boolean,
	error?: string,
	receiptHandle: string,
	deleteVersionId?: string
}

interface SourceAndDestination {
	copySource: string,

	sourceKey: string,
	sourceBucket: string,
	sourceVersionId: string
	destinationKey: string,
	destinationBucket: string,
	destination: string
}

export const lambdaHandler = async (
	event: SQSEvent, context: Context
): Promise<MoveResponse[]> => {
	console.log(`Event: ${JSON.stringify(event)}`)

	const promises: Promise<MoveResponse>[] = event.Records.flatMap(r0 => {
		const sqsRecord = r0 as SQSRecord
		const s3Event: S3Event = JSON.parse(sqsRecord.body)
		if ("Records" in s3Event) {


			return s3Event.Records.map(r1 => {
				const s3EventRecord = r1 as S3EventRecord
				return onObjectRecord(sqsRecord, s3EventRecord)
			})
		} else {
			return []

		}


	})
	return new Promise<MoveResponse[]>((resolve, reject) => {
		(async () => {
			const results = await Promise.all(promises)

			resolve(results)
		})()
	})

}

function getSourceAndDest(s3EventRecord: S3EventRecord): SourceAndDestination {
	const sourceKey = (decodeURIComponent(s3EventRecord.s3.object.key)).replace(/\+/g, " ")
	const sourceBucket = s3EventRecord.s3.bucket.name
	const destinationKey = getKeyMapping(process.env.DESTINATION_KEY!, sourceKey)
	return {
		sourceKey: sourceKey,
		sourceBucket: sourceBucket,
		sourceVersionId: s3EventRecord.s3.object.versionId!,
		copySource: `${sourceBucket}/${s3EventRecord.s3.object.key}?versionId=${s3EventRecord.s3.object.versionId}`,
		destinationBucket: process.env.DESTINATION_BUCKET_NAME!,

		destinationKey: destinationKey,
		destination: `${process.env.DESTINATION_BUCKET_NAME}/${destinationKey}`
	}
}

export function getKeyMapping(keyMapping: string, oldPath: string): string {

	let matches = /^(.*)=\${date}(:prefix|:suffix)?$/.exec(keyMapping)
	if (matches != undefined) {


		//use dynamic date
		const date = `${matches[1]}=\${date}`
		const prefixOrSuffix = matches[2]
		if (prefixOrSuffix == undefined || prefixOrSuffix.startsWith(":prefix")) {
			return replaceWithDate(`${date}/${oldPath}`)
		} else if (prefixOrSuffix.startsWith(":suffix")) {
			const oldPathItems = oldPath.split("/")
			return replaceWithDate(`${oldPathItems.slice(0, oldPathItems.length - 1).join("/")}/${date}/${oldPathItems.slice(oldPathItems.length - 1, oldPathItems.length)}`)
		}

	}
	matches = /\[{"oldPath":"(.*)","newPath":"(.*)"}*]/.exec(keyMapping)
	if (matches != undefined) {
		const pathMappings: { [key: string]: string }[] = JSON.parse(matches[0])

		const newPaths = pathMappings.filter(value => {
			let newPath = value["newPath"]
			matches = new RegExp(value["oldPath"]).exec(oldPath)
			return matches != null
		}).map(value => {
			let newPath = value["newPath"]
			matches = new RegExp(value["oldPath"]).exec(oldPath)
			if (matches != undefined) {
				matches.forEach((value: string, index: number) => {
					newPath = newPath.replace(`$${index}`, value)
				})
			}
			return newPath
		})
		if (newPaths.length > 0) {
			return replaceWithDate(newPaths[0])
		} else {
			return replaceWithDate(oldPath)
		}


	}
	return replaceWithDate(`${keyMapping}/${oldPath}`)
}

function replaceWithDate(path: string): string {
	let matches = /(\${date})/.exec(path)
	if (matches != undefined) {

		const today = new Date()
		//use dynamic date
		const date = `${today.toISOString().split('T')[0]}`
		return path.replace("${date}", date)
	}
	return path
}

async function copyObject(sqsRecord: SQSRecord, s3EventRecord: S3EventRecord): Promise<MoveResponse> {
	console.log(`${s3EventRecord.eventName}`)
	const sourceAndDest = getSourceAndDest(s3EventRecord)
	console.log(`SourceAndDest:${JSON.stringify(sourceAndDest)}`)
	const copyCommand = new CopyObjectCommand({
		Bucket: sourceAndDest.destinationBucket,
		Key: sourceAndDest.destinationKey,
		CopySource: sourceAndDest.copySource
	})
	return s3Client.send(copyCommand).then(function (r2) {
		console.log(`Copied : ${sourceAndDest.copySource} -> ${sourceAndDest.destination}`)
		const result: CopyObjectCommandOutput = r2 as CopyObjectCommandOutput
		return {
			bucket: sourceAndDest.destinationBucket,
			key: sourceAndDest.destinationKey,
			versionId: result.VersionId,
			success: result.$metadata.httpStatusCode == 200,
			receiptHandle: sqsRecord.receiptHandle

		} as MoveResponse
	}).catch(function (error) {
		console.error(`copyCommand: ${error}`)
		return {
			bucket: sourceAndDest.destinationBucket,
			key: sourceAndDest.destinationKey,
			success: false,
			error: error.message,
			receiptHandle: sqsRecord.receiptHandle

		} as MoveResponse
	})
}

async function tagDestinationObject(sourceAndDest: SourceAndDestination, moveResponse: MoveResponse): Promise<MoveResponse> {
	if (!moveResponse.success || moveResponse.deleteVersionId == null) {
		console.log(`Not tagging: ${!moveResponse.success} || ${moveResponse.deleteVersionId == null}`)
		return Promise.resolve(moveResponse)
	}
	const tags = [{
		Key: "mv-timestamp",
		Value: `${Date.now()}`
	}, {
		Key: "mv-delete-versionId",
		Value: moveResponse.deleteVersionId
	}, {
		Key: "mv-original-key",
		Value: sourceAndDest.sourceKey
	}, {
		Key: "mv-original-bucket",
		Value: sourceAndDest.sourceBucket
	}]

	const putObjectTaggingCommand = new PutObjectTaggingCommand({
		Bucket: sourceAndDest.destinationBucket,
		Key: sourceAndDest.destinationKey,
		Tagging: {
			TagSet: tags
		}
	})
	console.debug(JSON.stringify(putObjectTaggingCommand))
	return s3Client.send(putObjectTaggingCommand).then(value => {
		console.log(`Set moved tag : ${sourceAndDest.destinationBucket}/${sourceAndDest.destinationKey}`)
		return moveResponse
	}).catch(error => {
		console.error(`putObjectTaggingCommand: ${error}`)
		return {
			bucket: moveResponse.bucket,
			key: moveResponse.key,
			success: false,
			error: error.message,
			receiptHandle: moveResponse.receiptHandle
		} as MoveResponse
	})
}

async function deleteSourceObject(sourceDest: SourceAndDestination, moveResponse: MoveResponse): Promise<MoveResponse> {
	if (!moveResponse.success) {
		console.log(`Not deleting: ${!moveResponse.success}`)
		return Promise.resolve(moveResponse)
	}
	const deleteObjectCommand = new DeleteObjectCommand({
		Bucket: sourceDest.sourceBucket,
		Key: sourceDest.sourceKey,
	})
	try {
		const deleteObjectResponse = await s3Client.send(deleteObjectCommand)
		if (deleteObjectResponse.DeleteMarker != null && deleteObjectResponse.DeleteMarker) {
			console.log(`Delete marker ${deleteObjectResponse.VersionId} for : ${sourceDest.sourceBucket}/${sourceDest.sourceKey}?versionId=${sourceDest.sourceVersionId}`)
			return {
				bucket: moveResponse.bucket,
				key: moveResponse.key,
				success: true,
				versionId: moveResponse.versionId,
				deleteVersionId: deleteObjectResponse.VersionId
			} as MoveResponse
		} else {
			return moveResponse
		}
	}catch(e){
		const error=e as Error
		console.error(`deleteSourceObject: ${error}`)
		return {
			bucket: moveResponse.bucket,
			key: moveResponse.key,
			success: false,
			error: error.message
		} as MoveResponse
	}

}

async function deleteDestinationObject(sqsRecord: SQSRecord, s3EventRecord: S3EventRecord, sourceAndDestination: SourceAndDestination): Promise<MoveResponse> {

	const deleteObjectCommand = new DeleteObjectCommand({
		Bucket: sourceAndDestination.destinationBucket,
		Key: sourceAndDestination.destinationKey,

	})

	return s3Client.send(deleteObjectCommand).then(r5 => {
		console.log(`Deleted : ${sourceAndDestination.destinationBucket}/${sourceAndDestination.destinationKey}?versionId=${s3EventRecord.s3.object.versionId}`)
		return {
			bucket: sourceAndDestination.destinationBucket,
			key: sourceAndDestination.destinationKey,
			success: true,
			receiptHandle: sqsRecord.receiptHandle

		} as MoveResponse
	}).catch(error => {
		console.error(`deleteDestinationObject: ${error}`)
		return {
			bucket: sourceAndDestination.destinationBucket,
			key: sourceAndDestination.destinationKey,
			success: false,
			error: error.message
		} as MoveResponse
	})
}

async function deleteMessage(sqsRecord: SQSRecord, moveResponse: MoveResponse): Promise<MoveResponse> {
	const sqsArn = arn.parse(sqsRecord.eventSourceARN)
	const deleteMessageCommand = new DeleteMessageCommand({
		QueueUrl: `https://sqs.${sqsArn.region}.amazonaws.com/${sqsArn.accountId}/${sqsArn.resource}`,
		ReceiptHandle: moveResponse.receiptHandle
	})
	return sqsClient.send(deleteMessageCommand).then(value1 => {
		console.log(`Removed message for ${moveResponse.receiptHandle}`)
		return moveResponse
	}).catch(e => {
		const error: Error = e as Error
		console.error(`Could not remove message for ${moveResponse.receiptHandle}: ${error.message}`)
		return {
			bucket: moveResponse.bucket,
			key: moveResponse.key,
			success: false,
			error: error.message
		} as MoveResponse
	})
}

async function shouldDeleteDestination(sourceAndDest: SourceAndDestination): Promise<boolean> {
	const getObjectTaggingCommand = new GetObjectTaggingCommand({
		Bucket: sourceAndDest.destinationBucket,
		Key: sourceAndDest.destinationKey
	})
	console.log(JSON.stringify(getObjectTaggingCommand))
	return s3Client.send(getObjectTaggingCommand).then(value => {
		if (value.TagSet != null) {
			console.log(value.TagSet)
			const mvSourceVersionTag: Tag | undefined = value.TagSet.find((tag, index) => {
				if (tag.Key != null) {
					return tag.Key == "mv-delete-versionId"
				} else {
					return false
				}

			})

			if (mvSourceVersionTag == null) {
				console.log(`mvSourceVersionTag is null`)
				return true
			} else {
				console.log(`${mvSourceVersionTag.Value}!=${sourceAndDest.sourceVersionId}: ${mvSourceVersionTag.Value != sourceAndDest.sourceVersionId}`)
				return mvSourceVersionTag.Value != sourceAndDest.sourceVersionId
			}
		} else {
			console.log(`No tags for ${sourceAndDest.destinationBucket}/${sourceAndDest.destinationKey}`)
			return false
		}
	}).catch(reason => {
		console.error(`Could not get tags for ${sourceAndDest.sourceBucket}/${sourceAndDest.sourceKey}: ${reason.message}`)
		return false
	})
}

async function onObjectRecord(sqsRecord: SQSRecord, s3EventRecord: S3EventRecord): Promise<MoveResponse> {
	const sqsArn = arn.parse(sqsRecord.eventSourceARN)
	const sourceAndDest = getSourceAndDest(s3EventRecord)
	if (s3EventRecord.eventName.startsWith("ObjectCreated")) {
		try {
			const moveResponse = await copyObject(sqsRecord, s3EventRecord)
			await deleteSourceObject(sourceAndDest, moveResponse)
			await tagDestinationObject(sourceAndDest, moveResponse)
			await deleteMessage(sqsRecord, moveResponse)
			return moveResponse
		} catch (e) {
			const error: Error = e as Error
			console.error(`Could not process record ${sqsRecord.receiptHandle} for s3 event ${s3EventRecord.s3.object.key}: ${error.message}`)
			return {
				bucket: s3EventRecord.s3.bucket.name,
				key: s3EventRecord.s3.object.key,
				success: false,
				error: error.message
			} as MoveResponse
		}

	} else {
		return shouldDeleteDestination(sourceAndDest).then(shouldDelete => {
			if (shouldDelete) {
				return deleteDestinationObject(sqsRecord, s3EventRecord, sourceAndDest)
			} else {
				const moveRecord = {
					bucket: sourceAndDest.destinationBucket,
					key: sourceAndDest.destinationKey,
					success: false,
					error: `Dont delete`,
					receiptHandle: sqsRecord.receiptHandle
				} as MoveResponse
				return deleteMessage(sqsRecord, moveRecord)
			}
		})

	}
}

