import { spawn } from 'child_process';

/**
 * Appium 서버 관리
 */

export interface AppiumServerConfig {
  port?: number;
  host?: string;
  logLevel?: string;
}

export interface AppiumCapabilities {
  platformName: 'iOS' | 'Android';
  platformVersion?: string;
  deviceName?: string;
  udid?: string;
  app?: string;
  bundleId?: string;
  package?: string;
  activity?: string;
  automationName?: 'UiAutomator2' | 'XCUITest';
  [key: string]: any;
}

/**
 * Appium 서버가 실행 중인지 확인
 */
export async function isAppiumServerRunning(serverUrl: string = 'http://localhost:4723'): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/status`, { 
      signal: AbortSignal.timeout(2000) 
    });
    const data: any = await response.json();
    return data?.value?.ready === true;
  } catch {
    return false;
  }
}

/**
 * Appium 서버 시작 (appium 또는 npx appium 사용)
 */
export function startAppiumServer(config: AppiumServerConfig = {}): Promise<{ process: any; port: number }> {
  const port = config.port || 4723;
  const host = config.host || '0.0.0.0';
  const logLevel = config.logLevel || 'info';

  return new Promise(async (resolve, reject) => {
    // 먼저 서버가 이미 실행 중인지 확인
    const isRunning = await isAppiumServerRunning(`http://${host}:${port}`);
    if (isRunning) {
      resolve({ process: null, port });
      return;
    }

    // Xcode 경로 자동 설정
    try {
      const { autoConfigureXcode } = await import('../ios/xcode-utils');
      await autoConfigureXcode();
    } catch (error) {
      console.warn('Failed to auto-configure Xcode:', error);
    }

    // appium 명령어 찾기 (appium 또는 npx appium)
    let appiumCmd = 'appium';
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      await execAsync('which appium');
    } catch {
      // appium이 없으면 npx appium 사용
      appiumCmd = 'npx';
    }

    const args = appiumCmd === 'npx' 
      ? ['appium', '--port', port.toString(), '--address', host, '--log-level', logLevel]
      : ['--port', port.toString(), '--address', host, '--log-level', logLevel];

    // 환경 변수 설정 (Xcode 경로 등)
    // Xcode 경로를 명시적으로 설정
    const xcodePath = process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer';
    
    // xcode-select 경로 확인
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const { stdout: xcodeSelectPath } = await execAsync('xcode-select -p');
      const currentPath = xcodeSelectPath.trim();
      
      if (!currentPath.includes('Xcode.app')) {
        console.warn(`[WARN] xcode-select 경로가 올바르지 않습니다: ${currentPath}`);
        console.warn(`   Appium이 올바른 Xcode 경로를 찾지 못할 수 있습니다.`);
        console.warn(`   수정하려면: sudo xcode-select --switch ${xcodePath}`);
      }
    } catch (error) {
      console.warn('xcode-select 경로 확인 실패:', error);
    }
    
    const env = {
      ...process.env,
      DEVELOPER_DIR: xcodePath,
      // PATH에 Xcode 경로 추가 (Appium이 xcodebuild를 찾을 수 있도록)
      PATH: `${xcodePath}/usr/bin:${process.env.PATH || ''}`,
    };
    
    console.log(`Appium 서버 시작 - DEVELOPER_DIR: ${env.DEVELOPER_DIR}`);
    console.log(`Appium 서버 시작 - PATH: ${env.PATH?.substring(0, 100)}...`);

    const appiumProcess = spawn(appiumCmd, args, {
      stdio: 'pipe',
      cwd: process.cwd(),
      env,
    });

    let resolved = false;

    // 서버 시작 확인
    const checkInterval = setInterval(async () => {
      const isRunning = await isAppiumServerRunning(`http://${host}:${port}`);
      if (!resolved && isRunning) {
        resolved = true;
        clearInterval(checkInterval);
        resolve({ process: appiumProcess, port });
      }
    }, 1000);

    // 타임아웃
    setTimeout(() => {
      if (!resolved) {
        clearInterval(checkInterval);
        appiumProcess.kill();
        reject(new Error('Appium server failed to start within 30 seconds'));
      }
    }, 30000);

    appiumProcess.on('error', (error: any) => {
      if (!resolved) {
        clearInterval(checkInterval);
        reject(new Error(`Failed to start Appium: ${error.message}. Try: npm install -g appium`));
      }
    });

    // 프로세스 출력 로깅
    appiumProcess.stdout?.on('data', (data: any) => {
      const output = data.toString();
      if (output.includes('Appium REST http interface listener started')) {
        // 서버 시작 완료 신호
      }
    });

    appiumProcess.stderr?.on('data', (data: any) => {
      const output = data.toString();
      if (output.includes('Error') && !resolved) {
        clearInterval(checkInterval);
        reject(new Error(`Appium error: ${output}`));
      }
    });
  });
}

/**
 * Appium 서버 중지
 */
export function stopAppiumServer(process: any): void {
  if (process && !process.killed) {
    process.kill();
  }
}

/**
 * Appium 세션 생성
 */
export async function createAppiumSession(
  serverUrl: string,
  capabilities: AppiumCapabilities,
  timeoutMs: number = 300000, // 기본 5분 타임아웃
): Promise<string> {
  try {
    const response = await fetch(`${serverUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: capabilities,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      // WDA 에러 메시지에서 핵심 내용 추출
      const errorMsg = JSON.stringify(errorData);
      if (errorMsg.includes('invalid code signature') || errorMsg.includes('not been explicitly trusted')) {
        throw new Error(
          `WebDriverAgent 코드 서명이 유효하지 않거나 신뢰되지 않습니다.\n` +
          `iOS 디바이스에서 설정 → 일반 → VPN 및 디바이스 관리에서 개발자 앱을 신뢰해주세요.\n` +
          `또는 WDA를 다시 빌드하고 설치해야 합니다.\n\n원본 에러: ${errorMsg.substring(0, 300)}`
        );
      }
      if (errorMsg.includes('xcodebuild failed with code 65')) {
        throw new Error(
          `xcodebuild 실패 (code 65): Xcode 서명 설정 문제입니다.\n` +
          `1. Xcode에서 Apple 계정 로그인 확인\n` +
          `2. XCODE_ORG_ID 환경변수 설정 확인\n` +
          `3. WDA가 디바이스에 이미 설치되어 있다면 usePreinstalledWDA 사용\n\n원본 에러: ${errorMsg.substring(0, 300)}`
        );
      }
      // socket hang up: WDA가 설치됐지만 프록시 연결 실패 — 드라이버 버전 불일치 가능
      if (errorMsg.includes('socket hang up') || errorMsg.includes('Could not proxy')) {
        throw new Error(
          `WDA 프록시 연결 실패 (socket hang up).\n` +
          `원인 가능성:\n` +
          `  1. xcuitest-driver 버전 업데이트 필요: appium driver update xcuitest\n` +
          `  2. WDA 빌드 캐시 오래됨: rm -rf /tmp/katab-wda && Appium 재시작\n` +
          `  3. 디바이스에서 WDA 앱 신뢰 필요: 설정 → 일반 → VPN 및 디바이스 관리\n` +
          `  4. USB 연결 불안정: 케이블 재연결 시도\n\n원본 에러: ${errorMsg.substring(0, 300)}`
        );
      }
      throw new Error(`Appium session creation failed: ${response.status} ${response.statusText}. ${errorMsg.substring(0, 500)}`);
    }

    const data: any = await response.json();
    const sessionId = data.value?.sessionId || data.sessionId;

    if (!sessionId) {
      throw new Error(`No session ID returned from Appium. Response: ${JSON.stringify(data)}`);
    }

    return sessionId;
  } catch (error: any) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error(
        `Appium 세션 생성 타임아웃 (${Math.round(timeoutMs / 1000)}초).\n` +
        `WebDriverAgent 시작에 실패했을 수 있습니다.\n` +
        `1. iOS 디바이스에서 WDA 앱이 신뢰되어 있는지 확인\n` +
        `2. Appium 서버 로그 확인\n` +
        `3. XCODE_ORG_ID 환경변수 확인\n` +
        `4. xcuitest-driver 업데이트: appium driver update xcuitest`
      );
    }
    if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED')) {
      throw new Error(`Cannot connect to Appium server at ${serverUrl}. Please make sure Appium is running: appium --port 4723`);
    }
    throw error;
  }
}

/**
 * Appium 세션 종료
 */
export async function deleteAppiumSession(serverUrl: string, sessionId: string): Promise<void> {
  await fetch(`${serverUrl}/session/${sessionId}`, {
    method: 'DELETE',
  });
}

/**
 * Appium 액션 실행 (최적화된 버전)
 */
export async function executeAppiumAction(
  serverUrl: string,
  sessionId: string,
  action: string,
  params: any = {}
): Promise<any> {
  // 스크린샷은 GET 요청이어야 함
  const isGetRequest = action === 'screenshot' || action === 'source' || action === 'window/size' || action === 'window/rect' || action === 'alert/text';
  
  // execute_script는 특별 처리
  const isExecuteScript = action === 'execute_script';

  const fetchOptions: RequestInit = {
    method: isGetRequest ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 타임아웃 설정 (기본 30초, 스크린샷은 5초, actions는 15초)
    signal: AbortSignal.timeout(
      action === 'screenshot' ? 5000 :
      action === 'actions' ? 15000 :
      30000
    ),
  };

  if (!isGetRequest && Object.keys(params).length > 0) {
    fetchOptions.body = JSON.stringify(params);
  }

  let url: string;
  if (isExecuteScript) {
    // Appium 3.x는 /execute/sync, 2.x는 /execute
    url = `${serverUrl}/session/${sessionId}/execute/sync`;
  } else {
    url = `${serverUrl}/session/${sessionId}/${action}`;
  }
  
  try {
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Appium action failed: ${action} - ${response.status} ${response.statusText}. ${JSON.stringify(errorData)}`);
    }

    return response.json();
  } catch (error: any) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error(`Appium action timeout: ${action}`);
    }
    throw error;
  }
}
