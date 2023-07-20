import { Formatter, Status, formatterHelpers } from '@cucumber/cucumber';
import path from 'path';
import fs from 'fs';

let storedSuiteName: string = ``;

export default class TeamCityFormatter extends Formatter {
    constructor(options) {
        super(options);

        options.eventBroadcaster.on('envelope', (envelope) => {
            if (envelope.testCaseFinished) {
                this.logTestCase(envelope.testCaseFinished.testCaseStartedId)
            }
        });
    }

    logTestCase(testCaseStartedId): void {
        const testCaseAttempt = this.eventDataCollector.getTestCaseAttempt(testCaseStartedId);
        if (testCaseAttempt.willBeRetried)
            return;

        const fullTestName = this.getFullTestName(testCaseAttempt);
        const stepResults = Object.values(testCaseAttempt.stepResults);

        this.log(`##teamcity[testStarted name='${this.escape(fullTestName)}' flowId='${testCaseStartedId}']\n`);

        const stepFailed = stepResults.some(step => [Status.FAILED, Status.AMBIGUOUS].includes(step.status));
        if (stepFailed) {
            const failureDetails = formatterHelpers.formatIssue({
                colorFns: this.colorFns,
                number: 1,
                snippetBuilder: this.snippetBuilder,
                testCaseAttempt,
                supportCodeLibrary: this.supportCodeLibrary
            });
            this.log(`##teamcity[testFailed name='${this.escape(fullTestName)}' details='${this.escape(failureDetails)}' flowId='${testCaseStartedId}']\n`);
            this.logScreenshotArtifacts(testCaseAttempt);
        }

        const testCaseDurationInSeconds = (stepResults.map(obj => obj.duration.nanos).reduce((acc, curr) => acc + curr) / 1e9).toFixed(3);
        this.log(`##teamcity[testFinished name='${this.escape(fullTestName)}' duration='${testCaseDurationInSeconds}' flowId='${testCaseStartedId}']\n`);
    }

    convertToCamelCase(value): string {
      return value.replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => index === 0 ? word.toLowerCase() : word.toUpperCase())
        .replace(/[\s\W]+/g, '');
    }

    getFullTestName(testCaseAttempt): string {
        const suiteName = testCaseAttempt.gherkinDocument.uri;
        const packageName = suiteName.slice(suiteName.lastIndexOf('\\') + 1, suiteName.lastIndexOf('.'));
        const className = this.convertToCamelCase(testCaseAttempt.gherkinDocument.feature.name);
        const testName = this.getTestName(testCaseAttempt);
        return `${suiteName}: ${packageName}.${className}.${testName}`;
    }

    getTestName(testCaseAttempt): string {
        return this.convertToCamelCase(testCaseAttempt.pickle.name);
    }

    logScreenshotArtifacts(testCaseAttempt): void {
        const screenshots = Object.values(testCaseAttempt.stepAttachments);
        screenshots.flat().forEach(screenshot => this.logScreenshotArtifact(testCaseAttempt, screenshot));
    }

    logScreenshotArtifact(testCaseAttempt, screenshot): void {
        const fullTestName = this.getFullTestName(testCaseAttempt);
        const testName = this.getTestName(testCaseAttempt);
        const supportedMediaTypes = ['image/png'];
        if (!supportedMediaTypes.includes(screenshot.mediaType))
            return;

        const base64Encoding = 'base64';
        if (screenshot.contentEncoding.toLowerCase() != base64Encoding) {
            this.log(`Test: "${testName}" step: ${screenshot.testStepId} screenshot content encoding: ${screenshot.contentEncoding} is not supported`);
            return;
        }

        const screenshotsRootPath = process.env.TEAMCITY_CUCUMBER_PATH_TO_SCREENSHOTS ? process.env.TEAMCITY_CUCUMBER_PATH_TO_SCREENSHOTS : './screenshots'
        if (!fs.existsSync(screenshotsRootPath)) {
            fs.mkdirSync(screenshotsRootPath, { recursive: true })
        }

        const screenshotExtension = screenshot.mediaType.substring(screenshot.mediaType.lastIndexOf('/') + 1);
        const screenshotFileName = `${testName}.${screenshot.testStepId}.${screenshotExtension}`;
        const screenshotFilePath = path.join(screenshotsRootPath, screenshotFileName);
        fs.writeFileSync(screenshotFilePath, new Buffer(screenshot.body, base64Encoding));

        const screenshotArtifactRootPath = process.env.TEAMCITY_CUCUMBER_ARTIFACTS_SUB_FOLDER ? process.env.TEAMCITY_CUCUMBER_ARTIFACTS_SUB_FOLDER : 'screenshots'
        const screenshotArtifactPath = path.join(screenshotArtifactRootPath, screenshotFileName);
        const screenshotArtifactRule = `${screenshotFilePath} => ${screenshotArtifactPath}`;
        this.log(`##teamcity[publishArtifacts '${this.escape(screenshotArtifactRule)}']\n`);
        this.log(`##teamcity[testMetadata type='image' testName='${this.escape(fullTestName)}' value='${this.escape(screenshotArtifactPath)}']\n`);
    }

    escape(text): string {
        return text
            .replace(/\|/g, '||')
            .replace(/'/g, '|\'')
            .replace(/\n/g, '|n')
            .replace(/\r/g, '|r')
            .replace(/\[/g, '|[')
            .replace(/]/g, '|]');
    }
}
