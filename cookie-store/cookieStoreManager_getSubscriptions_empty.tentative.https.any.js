// META: title=Cookie Store API: ServiceWorker without cookie change subscriptions
// META: global=!default,serviceworker,window
// META: script=/service-workers/service-worker/resources/test-helpers.sub.js

'use strict';

promise_test(async testCase => {
  if (self.GLOBAL.isWindow()) {
    const registration = await service_worker_unregister_and_register(
        testCase, 'resources/empty_sw.js', 'resources/does/not/exist');
    testCase.add_cleanup(() => registration.unregister());

    // Must wait for the service worker to enter the 'activated' state before
    // subscribing to cookiechange events.
    await wait_for_state(testCase, registration.installing, 'activated');

    self.registration = registration;
  }

  const subscriptions = await registration.cookies.getSubscriptions();
  assert_equals(subscriptions.length, 0);
}, 'getSubscriptions returns an empty array when there are no subscriptions');
