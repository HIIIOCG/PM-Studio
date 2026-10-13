export function createGoogleBridge(runner = globalThis.google?.script?.run) {
  return function readTimeline() {
    return new Promise((resolve, reject) => {
      if (!runner || typeof runner.withSuccessHandler !== 'function') { reject(new Error('Schedule service is unavailable.')); return; }
      runner.withSuccessHandler(resolve).withFailureHandler(() => reject(new Error('Schedule service is unavailable.'))).getTimeline();
    });
  };
}
