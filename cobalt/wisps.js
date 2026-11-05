var wispOverride = new URLSearchParams(location.search).get("wisp");
window.COBALT_WISP_URLS = wispOverride && /^wss?:\/\//i.test(wispOverride)
  ? [wispOverride]
  : [
      "wss://anura.pro/",
      "wss://wisp.mercurywork.shop/"
    ];
