# aws-cdk-s3-replication-with-prefix

This cdk project demonstrates replicating S3 objects from a source bucket in one account
to a destination bucket in another account with a custom prefix applied to the replicated objects.

## Architecture

![Architecture](./images/architecture.drawio.png)

## Deployment

 * `npm run build`   compile typescript to js

### Context parameters
 * **sourceAccount** : The account id the source bucket lives in
 * **sourceRegion** : The region the source bucket lives in
 * **destinationAccount** : The account id the destination bucket lives in
 * **destinationRegion** : The region the destination bucket lives in
 * **destinationKey**: The key that you want objects replicated to in the destination bucket

### Deployment

1) Deploy the replication role to the source account
   1) `cdk deploy aws-cdk-s3-replication-with-prefix-source-replication-role-stack -c sourceAccount=<sourceAccount>  -c sourceRegion=<sourceRegion>  -c destinationAccount=<destinationAccount> -c destinationRegion=<destinationRegion> -c destinationKey=<destinationKey>`


2. Deploy the destination bucket and move object lambda to the destination account
   1) `cdk deploy aws-cdk-s3-replication-with-prefix-destination-stack -c sourceRegion=<sourceRegion> -c sourceAccount=<sourceAccount> -c destinationAccount=<destinationAccount> -c destinationRegion=<destinationRegion> -c destinationKey=<destinationKey>`


3. Deploy the source bucket to the source account with replication rules to the destination account
   1) `cdk deploy aws-cdk-s3-replication-with-prefix-source-stack -c sourceRegion=<sourceRegion> -c sourceAccount=<sourceAccount> -c destinationAccount=<destinationAccount> -c destinationRegion=<destinationRegion> -c destinationKey=<destinationKey>`

### Dynamic destination

**destinationKey** - Can either be a static value like "newPath" or a dynamic value. Dynamic values include the following;
   *  **<name>=${date}[:prefix|:suffix]** - will replace <name>=${date} either at the beginning (prefix, default) or the end (suffix) of the destination path  
   *  **["oldPath":"regex that matches the sourcePath","newPath":"replacement path using regex groups for replacement"]** - Array of json ojects with keys oldPath and newPath. oldPath is a regex that is used to match the original source path and then replace it with the value in newPath
## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

