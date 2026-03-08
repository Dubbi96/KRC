#!/usr/bin/env node
// @ts-nocheck

// .env 파일 자동 로드 (프로젝트 루트의 .env 파일에서 환경변수를 읽어옴)
import 'dotenv/config';

import { Command } from 'commander';
import { WebRecorder } from './web/recorder';
import { WebReplayer } from './web/replayer';
import { IOSRecorder } from './ios/recorder';
import { IOSReplayer } from './ios/replayer';
import { AndroidRecorder } from './android/recorder';
import { AndroidReplayer } from './android/replayer';
import { FileStorage } from './storage/file-storage';
import { ReportGenerator } from './reporter/generator';
import type { RecordingConfig, ReplayOptions, TestResult } from './types';
import { readFileSync } from 'fs';
import { join } from 'path';

const program = new Command();
program.name('katab').description('Recording-based QA test platform').version('0.1.0');

// Helper to load ESM modules
async function loadChalk() {
  return (await import('chalk')).default;
}
async function loadOra() {
  return (await import('ora')).default;
}
async function loadInquirer() {
  return (await import('inquirer')).default;
}

// Record command
program
  .command('record')
  .description('Start recording')
  .argument('<platform>', 'Platform: web, ios, android')
  .option('-u, --url <url>', 'Web URL')
  .option('-d, --udid <udid>', 'iOS device UDID')
  .option('-i, --device-id <id>', 'Android device ID')
  .option('-b, --bundle-id <id>', 'iOS bundle ID')
  .option('-p, --package <pkg>', 'Android package')
  .option('-a, --appium-url <url>', 'Appium server URL', 'http://localhost:4723')
  .option('-n, --name <name>', 'Scenario name')
  .option('-o, --output <dir>', 'Output directory', './scenarios')
  .option('--browser <browser>', 'Browser type', 'chromium')
  .option('--device <device>', 'Device emulation (desktop, iphone-14, iphone-14-pro-max, iphone-15-pro, pixel-7, galaxy-s24)')
  .option('--continue <id>', 'Continue recording from existing scenario ID')
  .option('--auth <id>', 'Auth profile ID to inject before recording')
  .option('--mirror', 'Open mirroring screen for iOS recording (default: true)')
  .option('--no-mirror', 'Disable mirroring screen')
  .option('--mirror-port <port>', 'Mirror server port', '8787')
  .action(async (platform: string, opts: any) => {
    const chalk = await loadChalk();
    const ora = await loadOra();
    const inquirer = await loadInquirer();

    if (platform === 'web') {
      await recordWeb(opts, chalk, ora, inquirer);
    } else if (platform === 'ios') {
      await recordIOS(opts, chalk, ora, inquirer);
    } else if (platform === 'android') {
      await recordAndroid(opts, chalk, ora, inquirer);
    } else {
      console.error(chalk.red(`Unknown platform: ${platform}`));
      process.exit(1);
    }
  });

function setupPauseToggle(recorder: WebRecorder, chalk: any): () => void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }
  const listener = (key: Buffer) => {
    // Ctrl+C: raw mode에서는 SIGINT가 자동 발생하지 않으므로 직접 emit
    if (key[0] === 3) {
      process.emit('SIGINT');
      return;
    }
    if (key.toString() === 'p' || key.toString() === 'P') {
      if (recorder.getIsPaused()) {
        recorder.unpause();
        console.log(chalk.green('\n[RESUME] 녹화 재개 (Recording resumed)'));
        console.log(chalk.yellow('  p: 일시정지 | Ctrl+C: 종료\n'));
      } else {
        recorder.pause();
        console.log(chalk.yellow('\n[PAUSE] 녹화 일시정지 (Recording paused)'));
        console.log(chalk.yellow('  p: 재개 | Ctrl+C: 종료\n'));
      }
    }
  };
  process.stdin.on('data', listener);
  return () => {
    process.stdin.removeListener('data', listener);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };
}

async function recordWeb(opts: any, chalk: any, ora: any, inquirer: any) {
  const spinner = ora('Initializing web recording...').start();
  try {
    const storage = new FileStorage(opts.output);

    // --continue: 기존 시나리오 이어서 녹화
    if (opts.continue) {
      spinner.text = 'Loading existing scenario...';
      const recorder = new WebRecorder({ outputDir: opts.output, browser: opts.browser, deviceType: opts.device || undefined, authProfileId: opts.auth || undefined }, storage);
      const id = await recorder.resume(opts.continue);
      const scenario = recorder.getScenario();
      const prevEvents = scenario?.events.length || 0;

      spinner.succeed(chalk.green(`Resuming recording: ${scenario?.name || id}`));
      console.log(chalk.cyan(`\nContinuing from ${prevEvents} existing events.`));
      console.log(chalk.cyan('Recording is active. Interact with the browser.'));
      console.log(chalk.yellow('Press p to pause/resume, Ctrl+C to stop.\n'));

      const cleanupPause = setupPauseToggle(recorder, chalk);
      process.on('SIGINT', async () => {
        cleanupPause();
        const s = ora('Saving...').start();
        try {
          const result = await recorder.stop();
          s.succeed(chalk.green(`Saved: ${result.name} (${result.events.length} events)`));
        } catch (e: any) { s.fail(chalk.red(e.message)); }
        process.exit(0);
      });
      await new Promise(() => {});
      return;
    }

    // 새 녹화
    let url = opts.url;
    if (!url) {
      spinner.stop();
      const answer = await inquirer.prompt([{ type: 'input', name: 'url', message: 'URL:', default: 'https://example.com' }]);
      url = answer.url;
      spinner.start();
    }

    let name = opts.name;
    if (!name) {
      spinner.stop();
      const answer = await inquirer.prompt([{ type: 'input', name: 'name', message: 'Scenario name:', default: `Web - ${new Date().toLocaleString()}` }]);
      name = answer.name;
      spinner.start();
    }

    spinner.text = 'Starting browser...';
    const recorder = new WebRecorder({ url, sessionName: name, outputDir: opts.output, browser: opts.browser, deviceType: opts.device || undefined, authProfileId: opts.auth || undefined }, storage);
    const id = await recorder.start();

    spinner.succeed(chalk.green(`Recording started! ID: ${id}`));
    console.log(chalk.cyan('\nRecording is active. Interact with the browser.'));
    console.log(chalk.yellow('Press p to pause/resume, Ctrl+C to stop.\n'));

    const cleanupPause = setupPauseToggle(recorder, chalk);
    process.on('SIGINT', async () => {
      cleanupPause();
      const s = ora('Saving...').start();
      try {
        const scenario = await recorder.stop();
        s.succeed(chalk.green(`Saved: ${scenario.name} (${scenario.events.length} events)`));
      } catch (e: any) { s.fail(chalk.red(e.message)); }
      process.exit(0);
    });
    await new Promise(() => {});
  } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1); }
}

async function recordIOS(opts: any, chalk: any, ora: any, inquirer: any) {
  const spinner = ora('Initializing iOS recording...').start();
  try {
    let udid = opts.udid;
    if (!udid) {
      spinner.stop();
      try {
        const { listIOSDevices } = await import('@katab/device-manager');
        const devices = await listIOSDevices();
        if (devices.length === 0) { console.error(chalk.red('No iOS devices found.')); process.exit(1); }
        const answer = await inquirer.prompt([{
          type: 'list', name: 'udid', message: 'Select device:',
          choices: devices.map((d: any) => ({ name: `${d.name} (${d.version}) - ${d.udid}`, value: d.udid })),
        }]);
        udid = answer.udid;
      } catch (e: any) { console.error(chalk.red(e.message)); process.exit(1); }
      spinner.start();
    }

    let bundleId = opts.bundleId;
    if (!bundleId) {
      spinner.stop();
      try {
        const { listIOSBundleIds } = await import('@katab/device-manager');
        const bundleIds = await listIOSBundleIds(udid);
        if (bundleIds.length > 0) {
          const SKIP = '__skip__';
          const INPUT = '__input__';
          const choices: any[] = bundleIds.map((b: string) => ({ name: b, value: b }));
          choices.push(new inquirer.Separator());
          choices.push({ name: '직접 입력', value: INPUT });
          choices.push({ name: '건너뛰기 (선택 안 함)', value: SKIP });
          const answer = await inquirer.prompt([{
            type: 'list', name: 'id', message: 'Bundle ID 선택:',
            choices,
            pageSize: 15,
          }]);
          if (answer.id === INPUT) {
            const manual = await inquirer.prompt([{ type: 'input', name: 'id', message: 'Bundle ID:' }]);
            bundleId = manual.id || undefined;
          } else if (answer.id !== SKIP) {
            bundleId = answer.id;
          }
        } else {
          const answer = await inquirer.prompt([{ type: 'input', name: 'id', message: 'Bundle ID (optional):' }]);
          bundleId = answer.id || undefined;
        }
      } catch {
        const answer = await inquirer.prompt([{ type: 'input', name: 'id', message: 'Bundle ID (optional):' }]);
        bundleId = answer.id || undefined;
      }
      spinner.start();
    }

    let name = opts.name;
    if (!name) {
      spinner.stop();
      const answer = await inquirer.prompt([{ type: 'input', name: 'name', message: 'Scenario name:', default: `iOS - ${new Date().toLocaleString()}` }]);
      name = answer.name;
      spinner.start();
    }

    const useMirror = opts.mirror !== false;
    const mirrorPort = parseInt(opts.mirrorPort || '8787', 10);

    spinner.text = 'Connecting to device...';
    const storage = new FileStorage(opts.output);
    const recorder = new IOSRecorder(udid, {
      udid, bundleId, appiumServerUrl: opts.appiumUrl,
      sessionName: name, outputDir: opts.output,
      mirror: useMirror, mirrorPort,
    }, storage);
    const id = await recorder.start();

    // 미러 서버 시작
    let mirrorServer: any = null;
    if (useMirror) {
      const controller = recorder.getController();
      if (controller) {
        const { IOSMirrorServer } = await import('./ios/mirror-server');
        mirrorServer = new IOSMirrorServer(recorder, controller);
        const { url } = await mirrorServer.start(mirrorPort);
        spinner.succeed(chalk.green(`Recording started! ID: ${id}`));
        console.log(chalk.cyan(`\nMirror: ${url}`));
        console.log(chalk.cyan('Open this URL in your browser to interact with the device.'));
        // macOS에서 브라우저 자동 오픈
        try {
          const { exec: execCmd } = await import('child_process');
          execCmd(`open ${url}`);
        } catch { /* 무시 */ }
      } else {
        spinner.succeed(chalk.green(`Recording started! ID: ${id}`));
        console.log(chalk.yellow('\nMirror unavailable: controller not initialized.'));
      }
    } else {
      spinner.succeed(chalk.green(`Recording started! ID: ${id}`));
      console.log(chalk.cyan('\nRecording is active. Interact with the device.'));
    }
    console.log(chalk.yellow('Press Ctrl+C to stop.\n'));

    process.on('SIGINT', async () => {
      const s = ora('Saving...').start();
      try {
        if (mirrorServer) await mirrorServer.stop();
        const scenario = await recorder.stop();
        s.succeed(chalk.green(`Saved: ${scenario.name} (${scenario.events.length} events)`));
      } catch (e: any) { s.fail(chalk.red(e.message)); }
      process.exit(0);
    });
    await new Promise(() => {});
  } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1); }
}

async function recordAndroid(opts: any, chalk: any, ora: any, inquirer: any) {
  const spinner = ora('Initializing Android recording...').start();
  try {
    let deviceId = opts.deviceId;
    if (!deviceId) {
      spinner.stop();
      try {
        const { listAndroidDevices } = await import('@katab/device-manager');
        const devices = await listAndroidDevices();
        if (devices.length === 0) { console.error(chalk.red('No Android devices found.')); process.exit(1); }
        const answer = await inquirer.prompt([{
          type: 'list', name: 'id', message: 'Select device:',
          choices: devices.map((d: any) => ({ name: `${d.model} (${d.version}) - ${d.id}`, value: d.id })),
        }]);
        deviceId = answer.id;
      } catch (e: any) { console.error(chalk.red(e.message)); process.exit(1); }
      spinner.start();
    }

    let pkg = opts.package;
    if (!pkg) {
      spinner.stop();
      try {
        const { listAndroidPackages, getCurrentAndroidPackage } = await import('@katab/device-manager');
        const currentPkg = await getCurrentAndroidPackage(deviceId);
        const packages = await listAndroidPackages(deviceId);
        if (packages.length > 0) {
          const SKIP = '__skip__';
          const INPUT = '__input__';
          const choices: any[] = [];
          if (currentPkg) {
            choices.push({ name: `${currentPkg} (현재 실행 중)`, value: currentPkg });
          }
          for (const p of packages) {
            if (p !== currentPkg) choices.push({ name: p, value: p });
          }
          choices.push(new inquirer.Separator());
          choices.push({ name: '직접 입력', value: INPUT });
          choices.push({ name: '건너뛰기 (선택 안 함)', value: SKIP });
          const answer = await inquirer.prompt([{
            type: 'list', name: 'pkg', message: 'Package 선택:',
            choices,
            pageSize: 15,
          }]);
          if (answer.pkg === INPUT) {
            const manual = await inquirer.prompt([{ type: 'input', name: 'pkg', message: 'Package name:' }]);
            pkg = manual.pkg || undefined;
          } else if (answer.pkg !== SKIP) {
            pkg = answer.pkg;
          }
        } else {
          const answer = await inquirer.prompt([{ type: 'input', name: 'pkg', message: 'Package (optional):' }]);
          pkg = answer.pkg || undefined;
        }
      } catch {
        const answer = await inquirer.prompt([{ type: 'input', name: 'pkg', message: 'Package (optional):' }]);
        pkg = answer.pkg || undefined;
      }
      spinner.start();
    }

    let name = opts.name;
    if (!name) {
      spinner.stop();
      const answer = await inquirer.prompt([{ type: 'input', name: 'name', message: 'Scenario name:', default: `Android - ${new Date().toLocaleString()}` }]);
      name = answer.name;
      spinner.start();
    }

    const useMirror = opts.mirror !== false;
    const mirrorPort = parseInt(opts.mirrorPort || '8787', 10);

    spinner.text = 'Connecting to device...';
    const storage = new FileStorage(opts.output);
    const recorder = new AndroidRecorder(deviceId, { deviceId, package: pkg, appiumServerUrl: opts.appiumUrl, sessionName: name, outputDir: opts.output }, storage);
    const id = await recorder.start();

    // 미러 서버 시작
    let mirrorServer: any = null;
    if (useMirror) {
      const controller = recorder.getController();
      if (controller) {
        const { AndroidMirrorServer } = await import('./android/mirror-server');
        mirrorServer = new AndroidMirrorServer(recorder, controller);
        const { url } = await mirrorServer.start(mirrorPort);
        spinner.succeed(chalk.green(`Recording started! ID: ${id}`));
        console.log(chalk.cyan(`\nMirror: ${url}`));
        console.log(chalk.cyan('Open this URL in your browser to interact with the device.'));
        try {
          const { exec: execCmd } = await import('child_process');
          execCmd(`open ${url}`);
        } catch { /* ignore */ }
      } else {
        spinner.succeed(chalk.green(`Recording started! ID: ${id}`));
        console.log(chalk.yellow('\nMirror unavailable: controller not initialized.'));
      }
    } else {
      spinner.succeed(chalk.green(`Recording started! ID: ${id}`));
      console.log(chalk.cyan('\nRecording is active. Interact with the device.'));
    }
    console.log(chalk.yellow('Press Ctrl+C to stop.\n'));

    process.on('SIGINT', async () => {
      const s = ora('Saving...').start();
      try {
        if (mirrorServer) await mirrorServer.stop();
        const scenario = await recorder.stop();
        s.succeed(chalk.green(`Saved: ${scenario.name} (${scenario.events.length} events)`));
      } catch (e: any) { s.fail(chalk.red(e.message)); }
      process.exit(0);
    });
    await new Promise(() => {});
  } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1); }
}

// Replay command
program
  .command('replay')
  .description('Replay a recorded scenario')
  .argument('<scenario>', 'Scenario file path or ID')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .option('-r, --report <dir>', 'Report output directory', './reports')
  .option('--speed <speed>', 'Playback speed', '1.0')
  .option('--screenshots', 'Take screenshots')
  .action(async (scenarioFile: string, opts: any) => {
    const chalk = await loadChalk();
    const ora = await loadOra();
    const spinner = ora('Loading scenario...').start();

    try {
      const storage = new FileStorage(opts.output);
      let scenario;
      if (scenarioFile.endsWith('.json')) {
        scenario = JSON.parse(readFileSync(scenarioFile, 'utf-8'));
      } else {
        scenario = await storage.loadScenario(scenarioFile);
        if (!scenario) { spinner.fail(chalk.red(`Not found: ${scenarioFile}`)); process.exit(1); }
      }

      spinner.stop();
      console.log(chalk.cyan(`\nReplaying: ${scenario.name}`));
      console.log(chalk.cyan(`Platform: ${scenario.platform} | Events: ${scenario.events.length} | Speed: ${opts.speed}x\n`));

      const replayOpts: ReplayOptions = {
        speed: parseFloat(opts.speed),
        takeScreenshots: opts.screenshots || false,
        reportDir: opts.report,
      };

      let result;
      if (scenario.platform === 'web') {
        result = await new WebReplayer().replay(scenario, replayOpts);
      } else if (scenario.platform === 'ios') {
        result = await new IOSReplayer().replay(scenario, replayOpts);
      } else if (scenario.platform === 'android') {
        result = await new AndroidReplayer().replay(scenario, replayOpts);
      } else {
        console.error(chalk.red(`Unsupported platform: ${scenario.platform}`)); process.exit(1);
      }

      if (result) {
        const passed = result.events.filter((e: any) => e.status === 'passed').length;
        const failed = result.events.filter((e: any) => e.status === 'failed').length;
        console.log(chalk.cyan('\nResults:'));
        console.log(`  Status: ${result.status === 'passed' ? chalk.green('PASSED') : chalk.red('FAILED')}`);
        console.log(`  Duration: ${(result.duration / 1000).toFixed(2)}s`);
        console.log(`  Passed: ${passed} | Failed: ${failed}`);
        if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
        console.log(chalk.cyan(`\n  Report: ${join(opts.report, scenario.id, 'report.html')}\n`));
        if (result.status === 'failed') process.exit(1);
      }
    } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1); }
  });

// List command
program
  .command('list')
  .description('List recorded scenarios')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .action(async (opts: any) => {
    const chalk = await loadChalk();
    const storage = new FileStorage(opts.output);
    const scenarios = await storage.listScenarios();
    if (scenarios.length === 0) { console.log(chalk.yellow('No scenarios found.')); return; }
    console.log(chalk.cyan(`\n${scenarios.length} scenario(s):\n`));
    scenarios.forEach((s, i) => {
      const dur = s.stoppedAt ? `${Math.round((s.stoppedAt - s.startedAt) / 1000)}s` : 'active';
      console.log(`${i + 1}. ${s.name}`);
      console.log(chalk.gray(`   ID: ${s.id} | Platform: ${s.platform} | Events: ${s.events.length} | Duration: ${dur}`));
      console.log('');
    });
  });

// Delete command
program
  .command('delete')
  .description('Delete a scenario')
  .argument('<id>', 'Scenario ID')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .action(async (id: string, opts: any) => {
    const chalk = await loadChalk();
    const storage = new FileStorage(opts.output);
    const deleted = await storage.deleteScenario(id);
    if (deleted) console.log(chalk.green(`Deleted: ${id}`));
    else console.log(chalk.red(`Not found: ${id}`));
  });

// ─── Edit command ─────────────────────────────────────────
program
  .command('edit')
  .description('Edit a recorded scenario (interactive)')
  .argument('<id>', 'Scenario ID')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .action(async (id: string, opts: any) => {
    const chalk = await loadChalk();
    const inquirer = await loadInquirer();
    const { ScenarioEditor } = await import('./editor/scenario-editor');
    const storage = new FileStorage(opts.output);
    const editor = new ScenarioEditor(storage);

    const scenario = await editor.load(id);
    if (!scenario) { console.error(chalk.red(`Not found: ${id}`)); process.exit(1); }

    let running = true;
    while (running) {
      console.log(editor.printSteps(scenario));

      const { action } = await inquirer.prompt([{
        type: 'list', name: 'action', message: 'What to do?',
        choices: [
          { name: '1. Show steps (refresh)', value: 'show' },
          { name: '2. Insert step', value: 'insert' },
          { name: '3. Edit step', value: 'update' },
          { name: '4. Delete step', value: 'delete' },
          { name: '5. Move step', value: 'move' },
          { name: '6. Toggle disable', value: 'toggle' },
          { name: '7. Add assertion', value: 'assertion' },
          { name: '8. Set variable', value: 'variable' },
          { name: '9. Set TC-ID', value: 'tcid' },
          { name: '10. Save & exit', value: 'save' },
          { name: '11. Discard & exit', value: 'discard' },
        ],
      }]);

      switch (action) {
        case 'show': break;

        case 'insert': {
          const { afterIdx } = await inquirer.prompt([{ type: 'number', name: 'afterIdx', message: 'Insert after step # (0=beginning):', default: scenario.events.length }]);
          const { stepType } = await inquirer.prompt([{
            type: 'list', name: 'stepType', message: 'Step type:',
            choices: ['click', 'fill', 'navigate', 'wait', 'wait_for_user', 'api_request', 'assert', 'set_variable', 'run_script',
              new inquirer.Separator('── RPA ──'),
              'extract_data', 'keyboard', 'hover', 'wait_for', 'for_each', 'if'],
          }]);
          const event = ScenarioEditor.createEvent(stepType);

          if (stepType === 'click' || stepType === 'fill') {
            const { selector } = await inquirer.prompt([{ type: 'input', name: 'selector', message: 'CSS selector:' }]);
            event.selector = selector;
            if (stepType === 'fill') {
              const { value } = await inquirer.prompt([{ type: 'input', name: 'value', message: 'Value (supports {{var}}):' }]);
              event.value = value;
              // 동적 값 추적: resolve 결과를 변수로 저장
              if (value.includes('{{$') || value.includes('{{')) {
                const { capVar } = await inquirer.prompt([{ type: 'input', name: 'capVar', message: '변수로 저장할 이름 (비우면 건너뜀):' }]);
                if (capVar) event.captureResolvedAs = capVar;
              }
            }
            if (stepType === 'click') {
              // 텍스트 기반 매칭: selector + 텍스트 조건으로 동적 요소 클릭
              const { mt } = await inquirer.prompt([{ type: 'input', name: 'mt', message: '텍스트 매칭 ({{var}} 가능, 비우면 건너뜀):' }]);
              if (mt) event.matchText = mt;
              // 클릭 요소의 텍스트를 변수로 캡처 (클립보드 복사처럼)
              const { capVar } = await inquirer.prompt([{ type: 'input', name: 'capVar', message: '클릭 텍스트를 변수로 저장할 이름 (비우면 건너뜀):' }]);
              if (capVar) event.captureResolvedAs = capVar;
            }
          } else if (stepType === 'navigate') {
            const { url } = await inquirer.prompt([{ type: 'input', name: 'url', message: 'URL:' }]);
            event.url = url;
          } else if (stepType === 'wait') {
            const { ms } = await inquirer.prompt([{ type: 'number', name: 'ms', message: 'Duration (ms):', default: 1000 }]);
            event.duration = ms;
          } else if (stepType === 'wait_for_user') {
            const { msg } = await inquirer.prompt([{ type: 'input', name: 'msg', message: 'Message:', default: '진행 준비가 되면 Enter를 누르세요' }]);
            event.waitForUser!.message = msg;
          } else if (stepType === 'api_request') {
            const { method } = await inquirer.prompt([{ type: 'list', name: 'method', message: 'Method:', choices: ['GET', 'POST', 'PUT', 'DELETE'] }]);
            const { apiUrl } = await inquirer.prompt([{ type: 'input', name: 'apiUrl', message: 'URL:' }]);
            event.apiRequest = { method, url: apiUrl };
          } else if (stepType === 'assert') {
            const { aType } = await inquirer.prompt([{
              type: 'list', name: 'aType', message: 'Assertion:',
              choices: [
                'url_contains', 'element_exists', 'text_contains', 'element_visible',
                new inquirer.Separator('── Video ──'),
                'video_playing', 'video_no_error',
              ],
            }]);
            if (aType === 'video_playing' || aType === 'video_no_error') {
              const { sel } = await inquirer.prompt([{ type: 'input', name: 'sel', message: 'Video selector (CSS, 컨테이너도 가능):', default: 'video' }]);
              const assertion: any = { type: aType, expected: 'true', target: sel };
              if (aType === 'video_playing') {
                const { observeMs } = await inquirer.prompt([{ type: 'number', name: 'observeMs', message: '관측 시간 (ms):', default: 2000 }]);
                const { minAdv } = await inquirer.prompt([{ type: 'number', name: 'minAdv', message: '최소 재생 진행량 (초):', default: 0.5 }]);
                assertion.videoConfig = { observeMs, minTimeAdvance: minAdv };
              }
              event.assertions = [assertion];
            } else {
              const { expected } = await inquirer.prompt([{ type: 'input', name: 'expected', message: 'Expected value:' }]);
              event.assertions = [{ type: aType, expected, target: aType.startsWith('element') ? (await inquirer.prompt([{ type: 'input', name: 'sel', message: 'Selector:' }])).sel : undefined }];
            }
          } else if (stepType === 'set_variable') {
            const { vName } = await inquirer.prompt([{ type: 'input', name: 'vName', message: 'Variable name:' }]);
            const { vVal } = await inquirer.prompt([{ type: 'input', name: 'vVal', message: 'Value:' }]);
            event.variableName = vName;
            event.variableValue = vVal;
          } else if (stepType === 'extract_data') {
            const { sel } = await inquirer.prompt([{ type: 'input', name: 'sel', message: 'CSS selector:' }]);
            const { extType } = await inquirer.prompt([{ type: 'list', name: 'extType', message: 'Extract type:', choices: ['text', 'attribute', 'innerHTML', 'value', 'table', 'list'] }]);
            const { capAs } = await inquirer.prompt([{ type: 'input', name: 'capAs', message: 'Save to variable:' }]);
            event.extractData = { selector: sel, extractType: extType, captureAs: capAs };
          } else if (stepType === 'keyboard') {
            const { key } = await inquirer.prompt([{ type: 'input', name: 'key', message: 'Key (e.g. Enter, Control+a, Escape):', default: 'Enter' }]);
            event.keyboard = { key };
          } else if (stepType === 'hover') {
            const { sel } = await inquirer.prompt([{ type: 'input', name: 'sel', message: 'CSS selector:' }]);
            event.selector = sel;
          } else if (stepType === 'wait_for') {
            const { wType } = await inquirer.prompt([{ type: 'list', name: 'wType', message: 'Wait type:', choices: ['element_visible', 'element_hidden', 'url_change', 'network_idle'] }]);
            const wfConfig: any = { waitType: wType, timeout: 10000 };
            if (wType === 'element_visible' || wType === 'element_hidden') {
              const { sel } = await inquirer.prompt([{ type: 'input', name: 'sel', message: 'CSS selector:' }]);
              wfConfig.selector = sel;
            } else if (wType === 'url_change') {
              const { pat } = await inquirer.prompt([{ type: 'input', name: 'pat', message: 'URL pattern:' }]);
              wfConfig.urlPattern = pat;
            }
            event.waitForConfig = wfConfig;
          } else if (stepType === 'for_each') {
            const { sel } = await inquirer.prompt([{ type: 'input', name: 'sel', message: 'Selector for items (e.g. table tbody tr):' }]);
            const startEvent = ScenarioEditor.createEvent('for_each_start');
            startEvent.forEachConfig = { selector: sel, maxIterations: 100 };
            const endEvent = ScenarioEditor.createEvent('for_each_end');
            editor.insertStep(scenario, afterIdx - 1, startEvent);
            editor.insertStep(scenario, afterIdx, endEvent);
            const { desc } = await inquirer.prompt([{ type: 'input', name: 'desc', message: 'Description:', default: '반복' }]);
            startEvent.description = desc;
            console.log(chalk.green(`for_each block inserted (start + end)`));
            break;
          } else if (stepType === 'if') {
            const { cType } = await inquirer.prompt([{ type: 'list', name: 'cType', message: 'Condition type:', choices: ['element_exists', 'element_visible', 'variable_equals', 'url_contains', 'custom'] }]);
            const startEvent = ScenarioEditor.createEvent('if_start');
            const ifConfig: any = { conditionType: cType };
            if (cType === 'element_exists' || cType === 'element_visible') {
              const { sel } = await inquirer.prompt([{ type: 'input', name: 'sel', message: 'CSS selector:' }]);
              ifConfig.selector = sel;
            } else if (cType === 'variable_equals') {
              const { vn } = await inquirer.prompt([{ type: 'input', name: 'vn', message: 'Variable name:' }]);
              const { ve } = await inquirer.prompt([{ type: 'input', name: 've', message: 'Expected value:' }]);
              ifConfig.variable = vn; ifConfig.expected = ve;
            } else if (cType === 'url_contains') {
              const { pat } = await inquirer.prompt([{ type: 'input', name: 'pat', message: 'URL pattern:' }]);
              ifConfig.expected = pat;
            } else if (cType === 'custom') {
              const { expr } = await inquirer.prompt([{ type: 'input', name: 'expr', message: 'JS expression:' }]);
              ifConfig.expression = expr;
            }
            startEvent.ifCondition = ifConfig;
            const endEvent = ScenarioEditor.createEvent('if_end');
            editor.insertStep(scenario, afterIdx - 1, startEvent);
            editor.insertStep(scenario, afterIdx, endEvent);
            console.log(chalk.green(`if block inserted (start + end)`));
            break;
          }

          const { desc } = await inquirer.prompt([{ type: 'input', name: 'desc', message: 'Description:', default: event.description || '' }]);
          event.description = desc;

          editor.insertStep(scenario, afterIdx - 1, event);
          console.log(chalk.green(`Step inserted at #${afterIdx}`));
          break;
        }

        case 'update': {
          const { idx } = await inquirer.prompt([{ type: 'number', name: 'idx', message: 'Step # to edit:', default: 1 }]);
          const ev = scenario.events[idx - 1];
          if (!ev) { console.log(chalk.red('Invalid step')); break; }
          const { field } = await inquirer.prompt([{
            type: 'list', name: 'field', message: `Editing step #${idx} (${ev.type}):`,
            choices: ['description', 'selector', 'value', 'url', 'duration', 'disabled'].filter(f => f !== undefined),
          }]);
          const { newVal } = await inquirer.prompt([{ type: 'input', name: 'newVal', message: `New ${field}:`, default: String((ev as any)[field] || '') }]);
          const update: any = {};
          if (field === 'duration' || field === 'disabled') update[field] = field === 'disabled' ? newVal === 'true' : parseInt(newVal);
          else update[field] = newVal;
          editor.updateStep(scenario, idx - 1, update);
          console.log(chalk.green(`Step #${idx} updated`));
          break;
        }

        case 'delete': {
          const { idx } = await inquirer.prompt([{ type: 'number', name: 'idx', message: 'Step # to delete:' }]);
          const removed = editor.deleteStep(scenario, idx - 1);
          if (removed) console.log(chalk.green(`Step #${idx} deleted`));
          else console.log(chalk.red('Invalid step'));
          break;
        }

        case 'move': {
          const { from } = await inquirer.prompt([{ type: 'number', name: 'from', message: 'Move from step #:' }]);
          const { to } = await inquirer.prompt([{ type: 'number', name: 'to', message: 'Move to step #:' }]);
          editor.moveStep(scenario, from - 1, to - 1);
          console.log(chalk.green(`Step moved: #${from} → #${to}`));
          break;
        }

        case 'toggle': {
          const { idx } = await inquirer.prompt([{ type: 'number', name: 'idx', message: 'Step # to toggle:' }]);
          editor.toggleStep(scenario, idx - 1);
          const ev = scenario.events[idx - 1];
          console.log(chalk.green(`Step #${idx}: ${ev?.disabled ? 'DISABLED' : 'ENABLED'}`));
          break;
        }

        case 'assertion': {
          const { idx } = await inquirer.prompt([{ type: 'number', name: 'idx', message: 'Add assertion to step #:' }]);
          const { aType } = await inquirer.prompt([{
            type: 'list', name: 'aType', message: 'Assertion type:',
            choices: ['url_contains', 'url_equals', 'element_exists', 'element_visible', 'text_contains', 'http_status', 'variable_equals'],
          }]);
          const { expected } = await inquirer.prompt([{ type: 'input', name: 'expected', message: 'Expected:' }]);
          let target: string | undefined;
          if (['element_exists', 'element_visible', 'variable_equals'].includes(aType)) {
            const r = await inquirer.prompt([{ type: 'input', name: 'target', message: 'Target (selector/variable):' }]);
            target = r.target;
          }
          editor.addAssertion(scenario, idx - 1, { type: aType, expected, target });
          console.log(chalk.green(`Assertion added to step #${idx}`));
          break;
        }

        case 'variable': {
          const { vName } = await inquirer.prompt([{ type: 'input', name: 'vName', message: 'Variable name:' }]);
          const { vVal } = await inquirer.prompt([{ type: 'input', name: 'vVal', message: 'Value:' }]);
          editor.setVariables(scenario, { [vName]: vVal });
          console.log(chalk.green(`Variable set: ${vName} = ${vVal}`));
          break;
        }

        case 'tcid': {
          const { tcId } = await inquirer.prompt([{ type: 'input', name: 'tcId', message: 'TC-ID:', default: scenario.tcId || '' }]);
          editor.setTcId(scenario, tcId);
          console.log(chalk.green(`TC-ID: ${tcId}`));
          break;
        }

        case 'save':
          await editor.save(scenario);
          console.log(chalk.green(`Saved: ${scenario.name} (v${scenario.version})`));
          running = false;
          break;

        case 'discard':
          console.log(chalk.yellow('Changes discarded.'));
          running = false;
          break;
      }
    }
  });

// ─── Edit:show command ────────────────────────────────────
program
  .command('show')
  .description('Show scenario steps in table format')
  .argument('<id>', 'Scenario ID')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .action(async (id: string, opts: any) => {
    const chalk = await loadChalk();
    const { ScenarioEditor } = await import('./editor/scenario-editor');
    const storage = new FileStorage(opts.output);
    const editor = new ScenarioEditor(storage);
    const scenario = await editor.load(id);
    if (!scenario) { console.error(chalk.red(`Not found: ${id}`)); process.exit(1); }
    console.log(editor.printSteps(scenario));
  });

// ─── Run command (with variables and dataset) ─────────────
program
  .command('run')
  .description('Run scenario with variables/datasets (includes support)')
  .argument('<id>', 'Scenario ID')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .option('-r, --report <dir>', 'Report output directory', './reports')
  .option('--speed <speed>', 'Playback speed', '1.0')
  .option('--screenshots', 'Take screenshots')
  .option('--dataset <name>', 'Test data set name')
  .option('--all-datasets', 'Run all datasets')
  .option('--var <pairs...>', 'Variables (key=value)')
  .option('--headless', 'Headless mode')
  .option('--stop-on-failure', 'Stop on first failure', true)
  .option('--auth <profileId>', 'Authentication profile ID')
  .option('--network-log <file>', 'mitmproxy JSONL log file path')
  .option('--har <file>', 'HAR file path (Charles/Proxyman)')
  .action(async (id: string, opts: any) => {
    const chalk = await loadChalk();
    const ora = await loadOra();
    const { TestRunner } = await import('./engine/runner');
    const storage = new FileStorage(opts.output);
    const runner = new TestRunner(storage);

    // --var key=value 파싱
    const variables: Record<string, string> = {};
    if (opts.var) {
      for (const pair of opts.var) {
        const [k, ...vParts] = pair.split('=');
        if (k && vParts.length > 0) variables[k] = vParts.join('=');
      }
    }

    const replayOpts: ReplayOptions = {
      speed: parseFloat(opts.speed),
      takeScreenshots: opts.screenshots || false,
      reportDir: opts.report,
      variables: Object.keys(variables).length > 0 ? variables : undefined,
      testDataSetName: opts.dataset,
      headless: opts.headless || false,
      stopOnFailure: opts.stopOnFailure,
      authProfileId: opts.auth || undefined,
      networkLogFile: opts.networkLog || undefined,
      networkHarFile: opts.har || undefined,
    };

    try {
      let results: TestResult[];
      if (opts.allDatasets) {
        const spinner = ora('Running all datasets...').start();
        replayOpts.onWaitForUserStart = () => {
          spinner.clear();  // 이전 출력 지우기
          spinner.stop();
        };
        replayOpts.onWaitForUserEnd = () => spinner.start('Running all datasets...');
        results = await runner.runParameterized(id, replayOpts);
        spinner.stop();
      } else {
        const spinner = ora('Running scenario...').start();
        replayOpts.onWaitForUserStart = () => {
          spinner.clear();  // 이전 출력 지우기
          spinner.stop();
        };
        replayOpts.onWaitForUserEnd = () => spinner.start('Running scenario...');
        const result = await runner.runSingle(id, replayOpts);
        spinner.stop();
        results = [result];
      }

      // 결과 출력
      console.log(chalk.cyan(`\n${'='.repeat(60)}`));
      console.log(chalk.cyan(`  Test Results: ${results.length} run(s)`));
      console.log(chalk.cyan(`${'='.repeat(60)}\n`));

      let allPassed = true;
      for (const r of results) {
        const passed = r.events.filter((e: any) => e.status === 'passed').length;
        const failed = r.events.filter((e: any) => e.status === 'failed').length;
        const skipped = r.events.filter((e: any) => e.status === 'skipped').length;
        const icon = r.status === 'passed' ? chalk.green('PASS') : chalk.red('FAIL');
        const dsLabel = r.testDataSetName ? ` [${r.testDataSetName}]` : '';

        console.log(`  ${icon}  ${r.scenarioName}${dsLabel}`);
        console.log(chalk.gray(`       Duration: ${(r.duration / 1000).toFixed(2)}s | Pass: ${passed} | Fail: ${failed} | Skip: ${skipped}`));
        if (r.error) console.log(chalk.red(`       Error: ${r.error}`));
        console.log(`       Report: ${join(opts.report, r.scenarioId, 'report.html')}`);
        console.log('');

        if (r.status === 'failed') allPassed = false;
      }

      if (!allPassed) process.exit(1);
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

// ─── Batch command ────────────────────────────────────────
program
  .command('batch')
  .description('Run multiple scenarios independently (each gets a fresh browser)')
  .argument('<ids...>', 'Scenario IDs to run')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .option('-r, --report <dir>', 'Report output directory', './reports')
  .option('--speed <speed>', 'Playback speed', '1.0')
  .option('--screenshots', 'Take screenshots')
  .option('--headless', 'Headless mode')
  .option('--stop-on-failure', 'Stop on first failure', true)
  .option('--device <type>', 'Device emulation (desktop, iphone-14, pixel-7, etc.)')
  .option('--auth <profileId>', 'Authentication profile ID')
  .option('--var <pairs...>', 'Variables (key=value)')
  .action(async (ids: string[], opts: any) => {
    const chalk = await loadChalk();
    const ora = await loadOra();
    const { TestRunner } = await import('./engine/runner');
    const storage = new FileStorage(opts.output);
    const runner = new TestRunner(storage);

    // --var key=value 파싱
    const variables: Record<string, string> = {};
    if (opts.var) {
      for (const pair of opts.var) {
        const [k, ...vParts] = pair.split('=');
        if (k && vParts.length > 0) variables[k] = vParts.join('=');
      }
    }

    const replayOpts: ReplayOptions = {
      speed: parseFloat(opts.speed),
      takeScreenshots: opts.screenshots || false,
      reportDir: opts.report,
      headless: opts.headless || false,
      stopOnFailure: opts.stopOnFailure,
      deviceType: opts.device || undefined,
      authProfileId: opts.auth || undefined,
      variables: Object.keys(variables).length > 0 ? variables : undefined,
    };

    console.log(chalk.cyan(`\n  Batch 실행: ${ids.length}개 시나리오 (각각 독립 브라우저)\n`));

    try {
      const results: TestResult[] = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const spinner = ora(`[${i + 1}/${ids.length}] 시나리오 실행 중: ${id}`).start();
        replayOpts.onWaitForUserStart = () => { spinner.clear(); spinner.stop(); };
        replayOpts.onWaitForUserEnd = () => spinner.start(`[${i + 1}/${ids.length}] 시나리오 실행 중: ${id}`);

        try {
          const result = await runner.runSingle(id, replayOpts);
          results.push(result);
          const icon = result.status === 'passed' ? chalk.green('PASS') : chalk.red('FAIL');
          spinner.stop();
          console.log(`  ${icon}  ${result.scenarioName} (${(result.duration / 1000).toFixed(2)}s)`);

          if (result.status === 'failed' && replayOpts.stopOnFailure) {
            console.log(chalk.yellow(`\n  실패로 인해 중단됨 (--stop-on-failure)`));
            break;
          }
        } catch (err: any) {
          spinner.stop();
          console.log(`  ${chalk.red('FAIL')}  ${id}: ${err.message}`);
          results.push({
            scenarioId: id, scenarioName: `Error: ${id}`, platform: 'web',
            status: 'failed', duration: 0, startedAt: Date.now(), completedAt: Date.now(),
            events: [], error: err.message,
          });
          if (replayOpts.stopOnFailure) break;
        }
      }

      // 결과 요약
      const passed = results.filter(r => r.status === 'passed').length;
      const failed = results.filter(r => r.status === 'failed').length;
      console.log(chalk.cyan(`\n${'='.repeat(50)}`));
      console.log(chalk.cyan(`  Batch 결과: ${passed} passed / ${failed} failed / ${results.length} total`));
      console.log(chalk.cyan(`${'='.repeat(50)}\n`));

      if (failed > 0) process.exit(1);
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

// ─── Chain command ────────────────────────────────────────
program
  .command('chain')
  .description('Run multiple scenarios sequentially in a shared browser (state preserved)')
  .argument('<ids...>', 'Scenario IDs to run in order')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .option('-r, --report <dir>', 'Report output directory', './reports')
  .option('--speed <speed>', 'Playback speed', '1.0')
  .option('--screenshots', 'Take screenshots')
  .option('--headless', 'Headless mode')
  .option('--stop-on-failure', 'Stop on first failure', true)
  .option('--device <type>', 'Device emulation (desktop, iphone-14, pixel-7, etc.)')
  .option('--auth <profileId>', 'Authentication profile ID')
  .option('--var <pairs...>', 'Variables (key=value)')
  .action(async (ids: string[], opts: any) => {
    const chalk = await loadChalk();
    const ora = await loadOra();
    const { ChainRunner } = await import('./dashboard/chain-runner');
    const storage = new FileStorage(opts.output);
    const chainRunner = new ChainRunner(storage);

    // --var key=value 파싱
    const variables: Record<string, string> = {};
    if (opts.var) {
      for (const pair of opts.var) {
        const [k, ...vParts] = pair.split('=');
        if (k && vParts.length > 0) variables[k] = vParts.join('=');
      }
    }

    const replayOpts: ReplayOptions = {
      speed: parseFloat(opts.speed),
      takeScreenshots: opts.screenshots || false,
      reportDir: opts.report,
      headless: opts.headless || false,
      stopOnFailure: opts.stopOnFailure,
      deviceType: opts.device || undefined,
      authProfileId: opts.auth || undefined,
      variables: Object.keys(variables).length > 0 ? variables : undefined,
    };

    console.log(chalk.cyan(`\n  Chain 실행: ${ids.length}개 시나리오 (브라우저 1개 공유, 상태 유지)\n`));

    const spinner = ora('Chain 실행 준비 중...').start();

    try {
      const results = await chainRunner.runChain(ids, replayOpts, {
        onScenarioStart: (_id, index, scenario) => {
          spinner.text = `[${index + 1}/${ids.length}] ${scenario.name}`;
        },
        onScenarioComplete: (_id, index, result) => {
          spinner.stop();
          const icon = result.status === 'passed' ? chalk.green('PASS') : chalk.red('FAIL');
          console.log(`  ${icon}  ${result.scenarioName} (${(result.duration / 1000).toFixed(2)}s)`);
          if (index < ids.length - 1) spinner.start(`[${index + 2}/${ids.length}] 다음 시나리오 준비 중...`);
        },
      });

      spinner.stop();

      // 결과 요약
      const passed = results.filter(r => r.status === 'passed').length;
      const failed = results.filter(r => r.status === 'failed').length;
      console.log(chalk.cyan(`\n${'='.repeat(50)}`));
      console.log(chalk.cyan(`  Chain 결과: ${passed} passed / ${failed} failed / ${results.length} total`));
      console.log(chalk.cyan(`${'='.repeat(50)}\n`));

      for (const r of results) {
        console.log(`  Report: ${join(opts.report, r.scenarioId, 'report.html')}`);
      }
      console.log('');

      if (failed > 0) process.exit(1);
    } catch (e: any) {
      spinner.stop();
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

// ─── Pick command ─────────────────────────────────────────
program
  .command('pick')
  .description('Pick an iOS element selector from the device screen')
  .argument('<platform>', 'Platform: ios')
  .option('-d, --udid <udid>', 'iOS device UDID')
  .option('-b, --bundle-id <id>', 'iOS bundle ID')
  .option('-a, --appium-url <url>', 'Appium server URL', 'http://localhost:4723')
  .option('--scenario-id <id>', 'Scenario ID (for dashboard integration)')
  .option('--dashboard-port <port>', 'Dashboard server port for result push', '3000')
  .option('--port <port>', 'Pick server port', '8788')
  .option('--mode <mode>', 'Pick mode: element (default) or image-match', 'element')
  .option('--step-idx <idx>', 'Step index for image-match mode (dashboard integration)')
  .option('--batch-plan <planId>', 'Batch re-pick plan ID (from dashboard)')
  .action(async (platform: string, opts: any) => {
    const chalk = await loadChalk();
    const ora = await loadOra();
    const inquirer = await loadInquirer();

    if (platform !== 'ios') {
      console.error(chalk.red(`Pick is currently supported for iOS only. Got: ${platform}`));
      process.exit(1);
    }

    const spinner = ora('Initializing iOS pick mode...').start();
    try {
      let udid = opts.udid;
      if (!udid) {
        spinner.stop();
        try {
          const { listIOSDevices } = await import('@katab/device-manager');
          const devices = await listIOSDevices();
          if (devices.length === 0) { console.error(chalk.red('No iOS devices found.')); process.exit(1); }
          const answer = await inquirer.prompt([{
            type: 'list', name: 'udid', message: 'Select device:',
            choices: devices.map((d: any) => ({ name: `${d.name} (${d.version}) - ${d.udid}`, value: d.udid })),
          }]);
          udid = answer.udid;
        } catch (e: any) { console.error(chalk.red(e.message)); process.exit(1); }
        spinner.start();
      }

      spinner.text = 'Connecting to device...';
      const { IOSController } = await import('@katab/device-manager');
      const controller = new IOSController(udid, opts.appiumUrl);
      await controller.createSession(opts.bundleId);

      spinner.text = 'Starting pick server...';
      const { IOSPickServer } = await import('./ios/pick-server');
      const pickServer = new IOSPickServer(controller);
      const port = parseInt(opts.port || '8788', 10);
      const dashboardPort = parseInt(opts.dashboardPort || '3000', 10);
      const stepIdx = opts.stepIdx ? parseInt(opts.stepIdx, 10) : undefined;
      const batchPlanId = opts.batchPlan || undefined;
      const { url } = await pickServer.start(port, dashboardPort, opts.scenarioId, opts.mode, stepIdx, batchPlanId);

      const isImageMatch = opts.mode === 'image-match';
      spinner.succeed(chalk.green(batchPlanId ? 'iOS Batch Pick mode started!' : isImageMatch ? 'iOS Image Match Pick mode started!' : 'iOS Pick mode started!'));
      console.log(chalk.cyan(`\n  Pick URL: ${url}`));
      if (batchPlanId) {
        console.log(chalk.cyan(`  Batch Plan: ${batchPlanId}`));
      }
      if (isImageMatch) {
        console.log(chalk.cyan('  Click two points to select a region for image matching.'));
      } else {
        console.log(chalk.cyan('  Click on the device screen to pick an element selector.'));
      }
      if (opts.scenarioId) {
        console.log(chalk.gray(`  Scenario: ${opts.scenarioId}`));
        console.log(chalk.gray(`  Dashboard: http://localhost:${dashboardPort}`));
      }
      console.log(chalk.yellow('\n  Press Ctrl+C to stop.\n'));

      // macOS auto-open browser
      try {
        const { exec: execCmd } = await import('child_process');
        execCmd(`open ${url}`);
      } catch { /* ignore */ }

      process.on('SIGINT', async () => {
        const s = ora('Stopping...').start();
        try {
          await pickServer.stop();
          await controller.closeSession?.();
          s.succeed(chalk.green('Pick mode stopped.'));
        } catch (e: any) { s.fail(chalk.red(e.message)); }
        process.exit(0);
      });
      await new Promise(() => {}); // Keep alive
    } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1); }
  });

// ─── Dashboard command ────────────────────────────────────
program
  .command('dashboard')
  .description('Start web dashboard for scenario management')
  .option('-p, --port <port>', 'Dashboard server port', '3000')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .option('-r, --report <dir>', 'Report output directory', './reports')
  .option('--dashboard-url <url>', 'Public dashboard URL for external access (e.g. https://katab.example.com)', process.env.DASHBOARD_URL)
  .action(async (opts: any) => {
    const chalk = await loadChalk();
    const { DashboardServer } = await import('./dashboard/dashboard-server');

    const server = new DashboardServer({
      port: parseInt(opts.port, 10),
      scenarioDir: opts.output,
      reportDir: opts.report,
      dashboardUrl: opts.dashboardUrl,
    });

    const { url } = await server.start();
    console.log(chalk.cyan(`\n  Katab Dashboard: ${url}`));
    console.log(chalk.gray('  Press Ctrl+C to stop.\n'));

    // macOS 브라우저 자동 오픈
    try {
      const { exec: execCmd } = await import('child_process');
      execCmd(`open ${url}`);
    } catch { /* ignore */ }

    process.on('SIGINT', async () => {
      await server.stop();
      process.exit(0);
    });
    await new Promise(() => {}); // Keep alive
  });

// ─── Worker command (Orchestrator 데몬) ────────────────────
program
  .command('worker')
  .description('Start a worker daemon for processing queued jobs')
  .argument('<target>', 'Target platform: web, ios, android')
  .option('--resource-id <id>', 'Resource identifier for this worker', 'default')
  .option('--redis <url>', 'Redis connection URL', 'redis://127.0.0.1:6379')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .option('-r, --report <dir>', 'Report output directory', './reports')
  .option('--concurrency <n>', 'Max concurrent jobs', '1')
  .option('--dashboard-url <url>', 'Dashboard URL for report links', process.env.DASHBOARD_URL || 'http://localhost:3000')
  .action(async (target: string, opts: any) => {
    const chalk = await loadChalk();

    if (!['web', 'ios', 'android'].includes(target)) {
      console.error(chalk.red(`Invalid target: ${target}. Must be web, ios, or android`));
      process.exit(1);
    }

    console.log(chalk.blue(`Starting ${target} worker daemon...`));
    console.log(chalk.gray(`  Resource: ${opts.resourceId}`));
    console.log(chalk.gray(`  Redis: ${opts.redis}`));
    console.log(chalk.gray(`  Concurrency: ${opts.concurrency}`));
    console.log(chalk.gray(`  Dashboard URL: ${opts.dashboardUrl}`));

    try {
      const { getDatabase } = await import('./orchestrator/db/client');
      const { getRedisConnectionFromUrl } = await import('./orchestrator/queue/connection');
      const { BaseWorker } = await import('./orchestrator/worker/base-worker');
      const { ResourcesRepository } = await import('./orchestrator/db/repositories/resources');

      const db = getDatabase();
      const redis = getRedisConnectionFromUrl(opts.redis);

      // 리소스가 없으면 자동 등록
      const resourcesRepo = new ResourcesRepository(db);
      const existing = resourcesRepo.getResource(opts.resourceId);
      if (!existing) {
        resourcesRepo.createResource(opts.resourceId, target as any, opts.resourceId);
        console.log(chalk.yellow(`  Auto-registered resource: ${opts.resourceId}`));
      }

      const worker = new BaseWorker({
        target: target as any,
        resourceId: opts.resourceId,
        redisConnection: redis,
        db,
        concurrency: parseInt(opts.concurrency, 10),
        scenarioDir: opts.output,
        reportDir: opts.report,
        dashboardUrl: opts.dashboardUrl,
      });

      await worker.start();
      console.log(chalk.green(`Worker "${worker.id}" is running. Press Ctrl+C to stop.`));

      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\nShutting down worker...'));
        await worker.stop();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await worker.stop();
        process.exit(0);
      });

      await new Promise(() => {}); // Keep alive
    } catch (err: any) {
      console.error(chalk.red(`Failed to start worker: ${err.message}`));
      process.exit(1);
    }
  });

// ─── Resource management command ───────────────────────────
const resourceCmd = program
  .command('resource')
  .description('Manage execution resources (web slots, devices)');

resourceCmd
  .command('add')
  .description('Register a new resource')
  .argument('<target>', 'Target: web, ios, android')
  .argument('[id]', 'Resource ID (auto-generated if omitted)')
  .option('--name <name>', 'Display name')
  .option('--metadata <json>', 'Metadata JSON string')
  .action(async (target: string, id: string | undefined, opts: any) => {
    const chalk = await loadChalk();

    if (!['web', 'ios', 'android'].includes(target)) {
      console.error(chalk.red(`Invalid target: ${target}`));
      process.exit(1);
    }

    try {
      const { getDatabase } = await import('./orchestrator/db/client');
      const { ResourcesRepository } = await import('./orchestrator/db/repositories/resources');

      const db = getDatabase();
      const repo = new ResourcesRepository(db);
      const resourceId = id || `${target}-slot-${Date.now().toString(36)}`;
      const name = opts.name || resourceId;
      const metadata = opts.metadata ? JSON.parse(opts.metadata) : undefined;

      repo.createResource(resourceId, target as any, name, metadata);
      console.log(chalk.green(`Resource registered: ${resourceId} (${target})`));
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
    }
  });

resourceCmd
  .command('list')
  .description('List all registered resources')
  .option('--target <target>', 'Filter by target (web/ios/android)')
  .action(async (opts: any) => {
    const chalk = await loadChalk();

    try {
      const { getDatabase } = await import('./orchestrator/db/client');
      const { ResourcesRepository } = await import('./orchestrator/db/repositories/resources');

      const db = getDatabase();
      const repo = new ResourcesRepository(db);
      const resources = repo.listResourcesWithLeaseStatus(opts.target);

      if (resources.length === 0) {
        console.log(chalk.gray('No resources registered.'));
        return;
      }

      console.log(chalk.bold('\nRegistered Resources:\n'));
      console.log('  ID                    Target   Enabled  Lease Status');
      console.log('  ──────────────────────────────────────────────────────');

      for (const r of resources) {
        const enabled = r.enabled ? chalk.green('Yes') : chalk.red('No');
        const lease = r.lease_worker_id
          ? chalk.yellow(`Leased by ${r.lease_worker_id}`)
          : chalk.green('Available');
        console.log(`  ${r.id.padEnd(22)} ${r.target.padEnd(8)} ${enabled.padEnd(12)}  ${lease}`);
      }
      console.log();
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
    }
  });

resourceCmd
  .command('remove')
  .description('Remove a resource')
  .argument('<id>', 'Resource ID')
  .action(async (id: string) => {
    const chalk = await loadChalk();

    try {
      const { getDatabase } = await import('./orchestrator/db/client');
      const { ResourcesRepository } = await import('./orchestrator/db/repositories/resources');

      const db = getDatabase();
      const repo = new ResourcesRepository(db);
      repo.deleteResource(id);
      console.log(chalk.green(`Resource removed: ${id}`));
    } catch (err: any) {
      console.error(chalk.red(`Failed: ${err.message}`));
    }
  });

// ─── Clone command ────────────────────────────────────────
program
  .command('clone')
  .description('Clone an existing scenario')
  .argument('<id>', 'Scenario ID to clone')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .action(async (id: string, opts: any) => {
    const chalk = await loadChalk();
    const storage = new FileStorage(opts.output);
    const original = await storage.loadScenario(id);
    if (!original) { console.error(chalk.red(`Not found: ${id}`)); process.exit(1); }

    const { randomUUID } = await import('crypto');
    const cloned = JSON.parse(JSON.stringify(original));
    cloned.id = randomUUID();
    cloned.name = original.name + ' (복사본)';
    cloned.version = 1;
    cloned.startedAt = Date.now();
    cloned.stoppedAt = undefined;
    await storage.saveScenario(cloned);
    console.log(chalk.green(`Cloned: ${cloned.name}`));
    console.log(chalk.gray(`  Original: ${id}`));
    console.log(chalk.gray(`  New ID:   ${cloned.id}`));
  });

// ─── Re-record command ───────────────────────────────────
program
  .command('re-record')
  .description('Partially re-record a scenario (replace steps from-to)')
  .argument('<id>', 'Scenario ID')
  .requiredOption('--from <index>', 'Start step index (0-based, inclusive)')
  .requiredOption('--to <index>', 'End step index (0-based, inclusive)')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .option('--auth <profileId>', 'Auth profile ID')
  .action(async (id: string, opts: any) => {
    const chalk = await loadChalk();
    const ora = await loadOra();
    const spinner = ora('Initializing partial re-record...').start();

    try {
      const storage = new FileStorage(opts.output);
      const { PartialReRecorder } = await import('./web/partial-re-recorder');
      const reRecorder = new PartialReRecorder(storage);

      const fromIndex = parseInt(opts.from, 10);
      const toIndex = parseInt(opts.to, 10);

      await reRecorder.start({
        scenarioId: id,
        replaceFromIndex: fromIndex,
        replaceToIndex: toIndex,
        scenarioDir: opts.output,
        authProfileId: opts.auth,
        onStatus: (status) => {
          if (status.phase === 'replaying' && status.replayProgress) {
            spinner.text = `Replaying step ${status.replayProgress.current}/${status.replayProgress.total}...`;
          } else if (status.phase === 'recording') {
            spinner.succeed(chalk.green('Recording mode active'));
            console.log(chalk.cyan('\nBrowser is open. Perform your actions.'));
            console.log(chalk.yellow('Press Ctrl+C to stop and save.\n'));
          } else if (status.phase === 'error') {
            spinner.fail(chalk.red(status.message || 'Error'));
          }
        },
      });

      process.on('SIGINT', async () => {
        const s = ora('Stopping and merging...').start();
        try {
          const result = await reRecorder.stop();
          s.succeed(chalk.green(`Done: ${result.newEventsCount} new events replaced (steps ${fromIndex}~${toIndex})`));
        } catch (e: any) { s.fail(chalk.red(e.message)); }
        process.exit(0);
      });
      await new Promise(() => {});
    } catch (e: any) { spinner.fail(chalk.red(e.message)); process.exit(1); }
  });

// ─── Doctor command (환경 진단) ────────────────────────────
program
  .command('doctor')
  .description('환경 진단: 필수 도구 및 서비스 상태 점검')
  .option('-o, --output <dir>', 'Scenario directory', './scenarios')
  .action(async (opts: any) => {
    const chalk = await loadChalk();
    const { execSync } = await import('child_process');
    const { existsSync, readdirSync } = await import('fs');
    const { resolve } = await import('path');

    console.log(chalk.bold('\nKatab Doctor'));
    console.log(chalk.gray('─────────────'));

    const checks: { label: string; ok: boolean; detail: string }[] = [];

    // 1. Port 3000
    try {
      execSync('lsof -i :3000 -sTCP:LISTEN', { stdio: 'pipe' });
      checks.push({ label: 'Port 3000', ok: false, detail: '사용 중 → 다른 포트를 사용하거나 기존 프로세스를 종료하세요' });
    } catch {
      checks.push({ label: 'Port 3000', ok: true, detail: '사용 가능' });
    }

    // 2. Playwright
    try {
      const ver = execSync('npx playwright --version 2>/dev/null', { stdio: 'pipe' }).toString().trim();
      checks.push({ label: 'Playwright', ok: true, detail: ver });
    } catch {
      checks.push({ label: 'Playwright', ok: false, detail: '미설치 → npx playwright install' });
    }

    // 3. Scenarios directory
    const scenDir = resolve(opts.output);
    if (existsSync(scenDir)) {
      const files = readdirSync(scenDir).filter((f: string) => f.endsWith('.json'));
      checks.push({ label: 'Scenarios', ok: true, detail: scenDir + ' (' + files.length + ' files)' });
    } else {
      checks.push({ label: 'Scenarios', ok: false, detail: scenDir + ' 디렉토리 없음 → mkdir -p ' + scenDir });
    }

    // 4. Redis (optional)
    try {
      execSync('redis-cli ping 2>/dev/null', { stdio: 'pipe', timeout: 3000 });
      checks.push({ label: 'Redis', ok: true, detail: '연결 성공' });
    } catch {
      checks.push({ label: 'Redis', ok: false, detail: '연결 실패 → redis-server 실행 필요 (스케줄링 사용 시)' });
    }

    // 5. Platform tools
    const platform = process.platform;
    if (platform === 'darwin') {
      try {
        const xcPath = execSync('xcode-select -p 2>/dev/null', { stdio: 'pipe' }).toString().trim();
        checks.push({ label: 'iOS Tools', ok: true, detail: 'Xcode CLI: ' + xcPath });
      } catch {
        checks.push({ label: 'iOS Tools', ok: false, detail: '미설치 → xcode-select --install' });
      }
    }

    try {
      execSync('adb version 2>/dev/null', { stdio: 'pipe' });
      checks.push({ label: 'Android Tools', ok: true, detail: 'adb 사용 가능' });
    } catch {
      checks.push({ label: 'Android Tools', ok: false, detail: 'adb 미설치 → Android SDK Platform-Tools 설치 필요' });
    }

    // Output
    const maxLabel = Math.max(...checks.map(c => c.label.length));
    for (const c of checks) {
      const icon = c.ok ? chalk.green('✓') : chalk.red('✗');
      const label = c.label.padEnd(maxLabel + 2);
      const detail = c.ok ? chalk.white(c.detail) : chalk.yellow(c.detail);
      console.log('  ' + icon + ' ' + label + detail);
    }

    const failCount = checks.filter(c => !c.ok).length;
    console.log('');
    if (failCount === 0) {
      console.log(chalk.green('  모든 항목이 정상입니다.\n'));
    } else {
      console.log(chalk.yellow('  ' + failCount + '개 항목에 문제가 있습니다.\n'));
    }
  });

program.parse();
