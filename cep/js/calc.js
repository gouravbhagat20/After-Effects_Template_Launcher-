/*
    BHCalc — pure bitrate / resolution math shared by the encoders.

    No side effects, no I/O — extracted from the inline math in ffmpeg.js and
    postrender.js so it can be unit-tested headlessly (see cep/test/bitrate.test.js).
    Exact ports: changing a number here changes encoder output, so keep it in
    sync with the ScriptUI equivalents.
*/
(function (global) {
    "use strict";

    /**
     * Two-pass ABR target bitrate (kbps) to land a clip of durationSec at a
     * targetMB size cap.
     *   kbps = floor(targetMB * 8192 * overhead / dur) - subtract, clamped to floor
     * opts: { overhead=1.0, subtract=0, floor=300, minDuration=0.5 }
     */
    function computeTargetKbps(targetMB, durationSec, opts) {
        opts = opts || {};
        var overhead = (opts.overhead == null) ? 1.0 : opts.overhead;
        var subtract = opts.subtract || 0;
        var floor = (opts.floor == null) ? 300 : opts.floor;
        var minDur = (opts.minDuration == null) ? 0.5 : opts.minDuration;

        var dur = Math.max(durationSec || 0, minDur);
        var kbps = Math.floor((targetMB * 8192 * overhead) / dur) - subtract;
        if (kbps < floor) kbps = floor;
        return kbps;
    }

    /**
     * When a size-capped encode still exceeds the cap, scale the bitrate down
     * proportionally (with a 3% safety margin) for the retry.
     */
    function retryKbps(prevKbps, targetMB, outMB, floor) {
        var k = Math.floor(prevKbps * (targetMB / outMB) * 0.97);
        if (floor != null && k < floor) k = floor;
        return k;
    }

    /**
     * Bitrate/effort multiplier by pixel count — port of the ScriptUI
     * getResolutionScale. SD encodes cheaper, 4K needs more.
     */
    function getResolutionScale(pixelCount) {
        if (pixelCount <= 0) return 1.0;          // unknown, baseline
        if (pixelCount <= 921600) return 0.6;     // SD (<= 1280x720)
        if (pixelCount <= 2073600) return 1.0;    // HD (1920x1080)
        if (pixelCount <= 3686400) return 1.4;    // 2K (2560x1440)
        return 2.0;                               // 4K (3840x2160+)
    }

    global.BHCalc = {
        computeTargetKbps: computeTargetKbps,
        retryKbps: retryKbps,
        getResolutionScale: getResolutionScale
    };
})(window);
