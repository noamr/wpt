// META: title=HTMLCanvasElement getContext(): script that runs while options are converted
'use strict';

// Converting the options argument of getContext() to a dictionary can run script. If that script
// changes the context mode of the canvas, the outer getContext() call has to act on the new
// context mode rather than create a second rendering context.

const contextIds = ['2d', 'bitmaprenderer', 'webgl', 'webgl2'];

const interfaceNames = {
  '2d': 'CanvasRenderingContext2D',
  'bitmaprenderer': 'ImageBitmapRenderingContext',
  'webgl': 'WebGLRenderingContext',
  'webgl2': 'WebGL2RenderingContext',
};

function loseWebGLContext(context) {
  if (context && typeof context.getExtension === 'function') {
    context.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

const webglSupport = {};
for (const contextId of ['webgl', 'webgl2']) {
  const probeContext = document.createElement('canvas').getContext(contextId);
  webglSupport[contextId] = probeContext !== null;
  loseWebGLContext(probeContext);
}

function requireContextId(contextId) {
  if (contextId in webglSupport) {
    assert_implements_optional(webglSupport[contextId], `getContext("${contextId}") is supported`);
  }
}

// Returns options with non-default values whose getters run callback the first time any of them is
// invoked, while counting how many times each getter is read. Not every context type (or
// implementation) reads alpha, but they all read alpha or willReadFrequently.
function optionsWithGetter(callback) {
  const state = {
    called: false,
    alphaCalls: 0,
    colorSpaceCalls: 0,
    willReadFrequentlyCalls: 0,
  };
  const run = value => {
    if (!state.called) {
      state.called = true;
      callback();
    }
    return value;
  };
  const options = {
    get alpha() {
      state.alphaCalls++;
      return run(false);
    },
    get colorSpace() {
      state.colorSpaceCalls++;
      return run('display-p3');
    },
    get willReadFrequently() {
      state.willReadFrequentlyCalls++;
      return run(true);
    },
  };
  return { options, state };
}

function assertSingleConversion(state) {
  assert_true(state.called, 'an options getter was invoked');
  assert_less_than_equal(state.alphaCalls, 1, 'alpha getter is read at most once');
  assert_less_than_equal(state.colorSpaceCalls, 1, 'colorSpace getter is read at most once');
  assert_less_than_equal(state.willReadFrequentlyCalls, 1,
                         'willReadFrequently getter is read at most once');
}

function assertContextSettings(contextId, context, expectedNonDefault) {
  if (contextId === 'webgl' || contextId === 'webgl2') {
    assert_equals(context.getContextAttributes().alpha, !expectedNonDefault,
                  `${contextId} alpha matches the creating call's settings`);
  } else if (contextId === '2d') {
    assert_equals(context.getImageData(0, 0, 1, 1).colorSpace,
                  expectedNonDefault ? 'display-p3' : 'srgb',
                  '2d colorSpace matches the creating call\'s settings');
  }
}

for (const outerId of contextIds) {
  for (const innerId of contextIds) {
    test(t => {
      requireContextId(innerId);

      const canvas = document.createElement('canvas');
      let innerContext;
      const { options, state } = optionsWithGetter(() => {
        innerContext = canvas.getContext(innerId);
      });
      t.add_cleanup(() => loseWebGLContext(innerContext));
      const outerContext = canvas.getContext(outerId, options);
      if (outerContext !== innerContext) {
        t.add_cleanup(() => loseWebGLContext(outerContext));
      }

      assertSingleConversion(state);
      assert_true(innerContext instanceof self[interfaceNames[innerId]],
                  `inner getContext("${innerId}") returns a ${interfaceNames[innerId]}`);
      if (outerId === innerId) {
        assert_equals(outerContext, innerContext,
                      'outer getContext() returns the context created by the inner call');
        assertContextSettings(innerId, outerContext, false);
      } else {
        assert_equals(outerContext, null, 'outer getContext() returns null');
      }
      assert_equals(canvas.getContext(innerId), innerContext,
                    'later getContext() calls return the context created by the inner call');
    }, `getContext("${outerId}") whose options getter calls getContext("${innerId}")`);
  }
}

for (const contextId of contextIds) {
  test(t => {
    requireContextId(contextId);

    const canvas = document.createElement('canvas');
    const throwingError = new Error('inner getter');
    const { options, state } = optionsWithGetter(() => {
      assert_equals(canvas.getContext('unknown'), null,
                    'getContext("unknown") returns null and leaves context mode as none');
      assert_throws_exactly(throwingError, () => canvas.getContext('2d', {
        get alpha() { throw throwingError; },
        get willReadFrequently() { throw throwingError; },
      }));
    });
    const context = canvas.getContext(contextId, options);
    t.add_cleanup(() => loseWebGLContext(context));

    assertSingleConversion(state);
    assert_true(context instanceof self[interfaceNames[contextId]],
                `getContext("${contextId}") returns a ${interfaceNames[contextId]}`);
    assertContextSettings(contextId, context, true);
  }, `getContext("${contextId}") forwards converted options once when getter leaves context mode as none`);
}

test(() => {
  const canvas = document.createElement('canvas');
  let innerContext;
  let middleContext;
  const { options: middleOptions } = optionsWithGetter(() => {
    innerContext = canvas.getContext('2d');
  });
  const { options: outerOptions } = optionsWithGetter(() => {
    middleContext = canvas.getContext('bitmaprenderer', middleOptions);
  });
  const outerContext = canvas.getContext('2d', outerOptions);

  assert_equals(middleContext, null, 'middle getContext("bitmaprenderer") returns null');
  assert_true(innerContext instanceof CanvasRenderingContext2D,
              'inner getContext("2d") returns a CanvasRenderingContext2D');
  assert_equals(outerContext, innerContext,
                'outer getContext("2d") returns the context created by the innermost call');
  assertContextSettings('2d', outerContext, false);
}, 'Two-level nested re-entrant getContext() dispatches on the final context mode at each frame');

for (const contextId of contextIds) {
  test(() => {
    const canvas = document.createElement('canvas');
    let offscreenCanvas;
    const { options, state } = optionsWithGetter(() => {
      offscreenCanvas = canvas.transferControlToOffscreen();
    });
    assert_throws_dom('InvalidStateError', () => canvas.getContext(contextId, options));
    assertSingleConversion(state);
    assert_throws_dom('InvalidStateError', () => canvas.getContext('2d'),
                      'canvas remains in placeholder context mode');
    assert_true(offscreenCanvas instanceof OffscreenCanvas,
                'transferControlToOffscreen() returns an OffscreenCanvas');
    assert_true(offscreenCanvas.getContext('2d') instanceof OffscreenCanvasRenderingContext2D,
                'transferred OffscreenCanvas can still create a context');
  }, `getContext("${contextId}") whose options getter calls transferControlToOffscreen()`);
}

for (const contextId of contextIds) {
  test(() => {
    const canvas = document.createElement('canvas');
    const error = new Error('options getter');
    const { options } = optionsWithGetter(() => {
      throw error;
    });
    assert_throws_exactly(error, () => canvas.getContext(contextId, options));

    const otherId = contextId === '2d' ? 'bitmaprenderer' : '2d';
    assert_true(canvas.getContext(otherId) instanceof self[interfaceNames[otherId]],
                `getContext("${otherId}") returns a ${interfaceNames[otherId]}`);
  }, `getContext("${contextId}") whose options getter throws leaves the context mode as none`);
}
