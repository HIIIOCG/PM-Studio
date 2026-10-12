export function createGoogleBridge(view, api = globalThis.google?.script?.run) {
  const allowed = view === 'internal' ? ['getTimeline', 'saveLayout'] : ['getTimeline'];
  return function callGoogle(method, input) {
    if (!allowed.includes(method)) return Promise.reject(new Error('這個版本沒有此操作。'));
    if (!api?.withSuccessHandler || !api?.withFailureHandler) return Promise.reject(new Error('Google 排程服務尚未連線。'));
    return new Promise((resolve, reject) => {
      const runner = api.withSuccessHandler(resolve).withFailureHandler((error) => reject(new Error(error?.message || '排程服務無法回應。')));
      if (method === 'getTimeline') runner.getTimeline();
      else runner.saveLayout(input);
    });
  };
}
