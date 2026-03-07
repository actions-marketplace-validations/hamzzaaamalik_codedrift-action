import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';

interface CodeDriftIssue {
  engineId: string;
  title: string;
  description: string;
  severity: 'critical' | 'error' | 'warning' | 'info';
  confidence: 'high' | 'medium' | 'low';
  location: {
    file: string;
    line: number;
    column: number;
  };
  fix?: string;
}

interface CodeDriftReport {
  issues: CodeDriftIssue[];
  summary: {
    totalFiles: number;
    totalIssues: number;
    bySeverity: Record<string, number>;
  };
}

function severityToAnnotation(severity: string): 'error' | 'warning' | 'notice' {
  switch (severity) {
    case 'critical':
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'notice';
  }
}

function severityEmoji(severity: string): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'error': return '🟠';
    case 'warning': return '🟡';
    default: return '🔵';
  }
}

async function run(): Promise<void> {
  try {
    const confidenceThreshold = core.getInput('confidence-threshold');
    const failOn = core.getInput('fail-on');
    const excludeTests = core.getInput('exclude-tests') === 'true';
    const workingDirectory = core.getInput('working-directory');
    const uploadSarif = core.getInput('sarif') === 'true';
    const version = core.getInput('version');

    const cwd = path.resolve(workingDirectory);
    const reportPath = path.join(cwd, 'codedrift-report.json');
    const sarifPath = path.join(cwd, 'codedrift-results.sarif');

    // Install codedrift
    core.info(`Installing codedrift@${version}...`);
    await exec.exec('npm', ['install', '-g', `codedrift@${version}`], { silent: true });

    // Run codedrift with JSON output
    const args = [
      '--format', 'json',
      '--output', reportPath,
      '--confidence-threshold', confidenceThreshold,
    ];

    if (excludeTests) {
      args.push('--exclude-tests');
    }

    let exitCode = 0;
    try {
      exitCode = await exec.exec('codedrift', args, {
        cwd,
        ignoreReturnCode: true,
      });
    } catch (e) {
      // codedrift exits non-zero when issues are found — that's expected
      core.debug(`codedrift exited with code ${exitCode}`);
    }

    // Also generate SARIF if requested
    if (uploadSarif) {
      await exec.exec('codedrift', [
        '--format', 'sarif',
        '--output', sarifPath,
        '--confidence-threshold', confidenceThreshold,
        ...(excludeTests ? ['--exclude-tests'] : []),
      ], { cwd, ignoreReturnCode: true });
    }

    // Parse report
    if (!fs.existsSync(reportPath)) {
      core.warning('CodeDrift report not generated. No issues found or codedrift failed to run.');
      core.setOutput('total-issues', '0');
      core.setOutput('critical-count', '0');
      core.setOutput('high-count', '0');
      return;
    }

    const reportRaw = fs.readFileSync(reportPath, 'utf-8');
    const report: CodeDriftReport = JSON.parse(reportRaw);
    const issues = report.issues || [];

    // Set outputs
    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    core.setOutput('total-issues', String(issues.length));
    core.setOutput('critical-count', String(criticalCount));
    core.setOutput('high-count', String(errorCount));
    core.setOutput('report-json', reportPath);

    // Create inline annotations on the PR diff
    for (const issue of issues) {
      const relativePath = path.relative(cwd, issue.location.file);
      const message = `${issue.title}\n${issue.description}${issue.fix ? `\nFix: ${issue.fix}` : ''}`;
      const level = severityToAnnotation(issue.severity);

      const properties: core.AnnotationProperties = {
        title: `CodeDrift: ${issue.title}`,
        file: relativePath.replace(/\\/g, '/'),
        startLine: issue.location.line,
        startColumn: issue.location.column,
      };

      switch (level) {
        case 'error':
          core.error(message, properties);
          break;
        case 'warning':
          core.warning(message, properties);
          break;
        default:
          core.notice(message, properties);
          break;
      }
    }

    // Generate job summary
    const summaryLines: string[] = [];
    summaryLines.push('## CodeDrift Security Scan Results\n');

    if (issues.length === 0) {
      summaryLines.push('No security issues found. Your code looks clean!\n');
    } else {
      summaryLines.push('| Severity | Count |');
      summaryLines.push('|----------|-------|');
      if (criticalCount > 0) summaryLines.push(`| ${severityEmoji('critical')} Critical | ${criticalCount} |`);
      if (errorCount > 0) summaryLines.push(`| ${severityEmoji('error')} Error | ${errorCount} |`);
      if (warningCount > 0) summaryLines.push(`| ${severityEmoji('warning')} Warning | ${warningCount} |`);
      summaryLines.push(`| **Total** | **${issues.length}** |`);
      summaryLines.push('');

      // Top issues table
      const topIssues = issues.slice(0, 10);
      summaryLines.push('### Top Issues\n');
      summaryLines.push('| Severity | Engine | File | Description |');
      summaryLines.push('|----------|--------|------|-------------|');

      for (const issue of topIssues) {
        const relativePath = path.relative(cwd, issue.location.file).replace(/\\/g, '/');
        const fileLink = `\`${relativePath}:${issue.location.line}\``;
        summaryLines.push(
          `| ${severityEmoji(issue.severity)} | ${issue.engineId} | ${fileLink} | ${issue.description.substring(0, 80)} |`
        );
      }

      if (issues.length > 10) {
        summaryLines.push(`\n*...and ${issues.length - 10} more issues. See the full report for details.*`);
      }
    }

    summaryLines.push('\n---\n*Scanned by [CodeDrift](https://www.npmjs.com/package/codedrift)*');

    await core.summary.addRaw(summaryLines.join('\n')).write();

    // Upload SARIF if requested
    if (uploadSarif && fs.existsSync(sarifPath)) {
      core.info('SARIF report generated at: ' + sarifPath);
      core.info('Use github/codeql-action/upload-sarif@v3 in a subsequent step to upload it.');
    }

    // Determine if we should fail
    const shouldFail =
      (failOn === 'error' && (criticalCount > 0 || errorCount > 0)) ||
      (failOn === 'warn' && issues.length > 0);

    if (shouldFail) {
      core.setFailed(`CodeDrift found ${issues.length} issue(s): ${criticalCount} critical, ${errorCount} error, ${warningCount} warning`);
    } else if (issues.length > 0) {
      core.info(`CodeDrift found ${issues.length} issue(s) but fail-on is set to '${failOn}' - not failing the build.`);
    } else {
      core.info('CodeDrift: No issues found!');
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
