'use strict';
// These tests rely on the User Agent providing an implementation of
// platform nfc backends.
//
// In Chromium-based browsers this implementation is provided by a polyfill
// in order to reduce the amount of test-only code shipped to users. To enable
// these tests the browser must be run with these options:
//
//   --enable-blink-features=MojoJS,MojoJSTest
let loadChromiumResources = Promise.resolve().then(() => {
  if (!window.MojoInterfaceInterceptor) {
    // Do nothing on non-Chromium-based browsers or when the Mojo bindings are
    // not present in the global namespace.
    return;
  }

  let chain = Promise.resolve();
  [
    '/gen/layout_test_data/mojo/public/js/mojo_bindings.js',
    '/gen/services/device/public/mojom/nfc.mojom.js',
    '/resources/chromium/nfc-mock.js',
  ].forEach(path => {
    let script = document.createElement('script');
    script.src = path;
    script.async = false;
    chain = chain.then(() => new Promise(resolve => {
      script.onload = resolve;
    }));
    document.head.appendChild(script);
  });

  return chain;
});

async function initialize_nfc_tests() {
  if (typeof WebNFCTest === 'undefined') {
    await loadChromiumResources;
  }
  assert_true(
      typeof WebNFCTest !== 'undefined',
      'WebNFC testing interface is not available.');
  let NFCTest = new WebNFCTest();
  await NFCTest.initialize();
  return NFCTest;
}

function nfc_test(func, name, properties) {
  promise_test(async t => {
    let NFCTest = await initialize_nfc_tests();
    t.add_cleanup(async () => {
      await NFCTest.reset();
    });
    await func(t, NFCTest.getMockNFC());
  }, name, properties);
}

const test_text_data = 'Test text data.';
const test_text_byte_array = new TextEncoder('utf-8').encode(test_text_data);
const test_number_data = 42;
const test_json_data = {level: 1, score: 100, label: 'Game'};
const test_url_data = 'https://w3c.github.io/web-nfc/';
const test_message_origin = 'https://127.0.0.1:8443';
const test_buffer_data = new ArrayBuffer(test_text_byte_array.length);
const test_buffer_view = new Uint8Array(test_buffer_data);
test_buffer_view.set(test_text_byte_array);
const fake_tag_serial_number = 'c0:45:00:02';

const NFCHWStatus = {};
// OS-level NFC setting is ON
NFCHWStatus.ENABLED = 1;
// no NFC chip
NFCHWStatus.NOT_SUPPORTED = NFCHWStatus.ENABLED + 1;
// OS-level NFC setting OFF
NFCHWStatus.DISABLED = NFCHWStatus.NOT_SUPPORTED + 1;

function createMessage(records) {
  if (records !== undefined) {
    let message = {};
    message.records = records;
    return message;
  }
}

function createRecord(recordType, data, mediaType, encoding, lang) {
  let record = {};
  if (recordType !== undefined)
    record.recordType = recordType;
  if (mediaType !== undefined)
    record.mediaType = mediaType;
  if (encoding !== undefined)
    record.encoding = encoding;
  if (lang !== undefined)
    record.lang = lang;
  if (data !== undefined)
    record.data = data;
  return record;
}

function createTextRecord(data, encoding, lang) {
  return createRecord('text', data, undefined, encoding, lang);
}

function createMimeRecordFromJson(json) {
  return createRecord(
      'mime', new TextEncoder('utf-8').encode(JSON.stringify(json)),
      'application/json');
}

function createMimeRecord(buffer) {
  return createRecord('mime', buffer, 'application/octet-stream');
}

function createUnknownRecord(buffer) {
  return createRecord('unknown', buffer);
}

function createUrlRecord(url, isAbsUrl) {
  if (isAbsUrl) {
    return createRecord('absolute-url', url);
  }
  return createRecord('url', url);
}

function createNDEFPushOptions(target, ignoreRead) {
  return {target, ignoreRead};
}

// Compares NDEFMessageSource that was provided to the API
// (e.g. NDEFWriter.push), and NDEFMessage that was received by the
// mock NFC service.
function assertNDEFMessagesEqual(providedMessage, receivedMessage) {
  // If simple data type is passed, e.g. String or ArrayBuffer or
  // ArrayBufferView, convert it to NDEFMessage before comparing.
  // https://w3c.github.io/web-nfc/#dom-ndefmessagesource
  let provided = providedMessage;
  if (providedMessage instanceof ArrayBuffer ||
      ArrayBuffer.isView(providedMessage))
    provided = createMessage([createMimeRecord(providedMessage)]);
  else if (typeof providedMessage === 'string')
    provided = createMessage([createTextRecord(providedMessage)]);

  assert_equals(provided.records.length, receivedMessage.data.length,
      'NDEFMessages must have same number of NDEFRecords');

  // Compare contents of each individual NDEFRecord
  for (let i = 0; i < provided.records.length; ++i)
    compareNDEFRecords(provided.records[i], receivedMessage.data[i]);
}

// Used to compare two NDEFMessage, one that is received from
// NDEFWriter.onreading() EventHandler and another that is provided to mock NFC
// service.
function assertWebNDEFMessagesEqual(message, expectedMessage) {
  assert_equals(message.records.length, expectedMessage.records.length);

  for(let i in message.records) {
    let record = message.records[i];
    let expectedRecord = expectedMessage.records[i];
    assert_equals(record.recordType, expectedRecord.recordType);
    assert_equals(record.mediaType, expectedRecord.mediaType);

    // Compares record data
    assert_array_equals(new Uint8Array(record.data),
          new Uint8Array(expectedRecord.data));
  }
}

function testNDEFScanOptions(message, scanOptions, unmatchedScanOptions, desc) {
  nfc_test(async (t, mockNFC) => {
    const reader1 = new NDEFReader();
    const reader2 = new NDEFReader();
    const controller = new AbortController();

    // Reading from unmatched reader will not be triggered
    reader1.onreading = t.unreached_func("reading event should not be fired.");
    unmatchedScanOptions.signal = controller.signal;
    await reader1.scan(unmatchedScanOptions);

    const readerWatcher = new EventWatcher(t, reader2, ["reading", "error"]);
    const promise = readerWatcher.wait_for("reading").then(event => {
      controller.abort();
      assertWebNDEFMessagesEqual(event.message, new NDEFMessage(message));
    });
    scanOptions.signal = controller.signal;
    await reader2.scan(scanOptions);

    mockNFC.setReadingMessage(message);
    await promise;
  }, desc);
}

function testReadingMultiMessages(
    message, scanOptions, unmatchedMessage, desc) {
  nfc_test(async (t, mockNFC) => {
    const reader = new NDEFReader();
    const controller = new AbortController();
    const readerWatcher = new EventWatcher(t, reader, ["reading", "error"]);
    const promise = readerWatcher.wait_for("reading").then(event => {
      controller.abort();
      assertWebNDEFMessagesEqual(event.message, new NDEFMessage(message));
    });
    scanOptions.signal = controller.signal;
    await reader.scan(scanOptions);

    // Unmatched message will not be read
    mockNFC.setReadingMessage(unmatchedMessage);
    mockNFC.setReadingMessage(message);
    await promise;
  }, desc);
}
