(() => {
  'use strict';

  const ROW = 4;
  const AMBIENT = 13;
  const SKY_AMBIENT = 14;
  const LAMP0 = 15;
  const LAMP1 = 17;
  const FOG = 18;
  const EXPOSURE = 20;
  const LIGHT_LIMIT = 21;
  const LIGHT_MAP_EXTENT = 24;
  const ENV_SPECULAR = 31;
  const AMBIENT_NO_IBL = 32;
  const SKY_AMBIENT_NO_IBL = 33;
  const AMBIENT_CUBE = 34;
  const AMBIENT_CUBE_ROWS = 12;
  const LOCAL_LIGHT_DISTANCE = 51;
  const LIGHT_LERP = 52;
  const ALWAYS_FAR = -1e6;

  const GRADE_RED = 2;
  const TONE_CURVE = 6;
  const TONE_SCALE = 7;
  const BLOOM = 11;
  const SSAO_FADE = 2;
  const MIN_BLOOM_THRESHOLD = 1;
  const NEUTRAL_TONE_CURVE = [0, 1.17, 0.796, 0.374];

  const setRgb = (values, row, value) => {
    const at = row * ROW;
    values[at] = value;
    values[at + 1] = value;
    values[at + 2] = value;
  };

  const scene = values => {
    setRgb(values, AMBIENT, 1);
    setRgb(values, AMBIENT_NO_IBL, 1);
    setRgb(values, SKY_AMBIENT, 0);
    setRgb(values, SKY_AMBIENT_NO_IBL, 0);
    setRgb(values, LAMP0, 0);
    setRgb(values, LAMP1, 0);
    setRgb(values, LIGHT_MAP_EXTENT, 0);
    for (let i = 0; i < AMBIENT_CUBE_ROWS; i++) setRgb(values, AMBIENT_CUBE + i, 0);
    values[SKY_AMBIENT * ROW + 3] = 0;
    values[ENV_SPECULAR * ROW + 3] = 0;
    values.fill(0, FOG * ROW, (FOG + 1) * ROW);
    const hdrScale = values[EXPOSURE * ROW + 2];
    if (hdrScale > 0) {
      values[EXPOSURE * ROW] = hdrScale;
      values[EXPOSURE * ROW + 1] = 1 / hdrScale;
    }
    const limit = LIGHT_LIMIT * ROW + 3;
    if (values[limit] < 1) values[limit] = 1;
    values[LOCAL_LIGHT_DISTANCE * ROW + 3] = ALWAYS_FAR;
    values[LIGHT_LERP * ROW + 1] = 1;
  };

  const grade = values => {
    for (let channel = 0; channel < 3; channel++) {
      const at = (GRADE_RED + channel) * ROW;
      values.fill(0, at, at + ROW);
      values[at + channel] = 1;
    }
    NEUTRAL_TONE_CURVE.forEach((value, i) => { values[TONE_CURVE * ROW + i] = value; });
    values[TONE_SCALE * ROW] = 1;
  };

  const bloom = values => {
    const at = BLOOM * ROW + 1;
    if (values[at] < MIN_BLOOM_THRESHOLD) values[at] = MIN_BLOOM_THRESHOLD;
  };

  const ssao = values => {
    values[SSAO_FADE * ROW + 3] = 0;
  };

  const OVERRIDE = {
    scene: { block: 0, apply: scene },
    grade: { block: 1, apply: grade },
    bloom: { block: 1, apply: bloom },
    gradeBloom: { block: 1, apply: values => { grade(values); bloom(values); } },
    ssao: { block: 1, apply: ssao },
  };

  const READS_SCENE_LIGHT = /\bCB0\[(?:13|18|23|32)\]/;
  const DRAWS_CLOUDS = /\bCloudsDistanceField/;
  const READS_GRADE = /\bdot\(\w+, CB1\[2\]\.xyz\) \+ CB1\[2\]\.w\b/;
  const READS_BLOOM = /\bCB1\[11\]\.y\b/;
  const READS_SSAO_FADE = /\* CB1\[2\]\.w\), 0\.0, 1\.0\)/;

  const overrideFor = (vertex, fragment) => {
    if (READS_SCENE_LIGHT.test(vertex) || READS_SCENE_LIGHT.test(fragment)) return DRAWS_CLOUDS.test(fragment) ? null : OVERRIDE.scene;
    const hasGrade = READS_GRADE.test(fragment);
    const hasBloom = READS_BLOOM.test(fragment);
    if (hasGrade) return hasBloom ? OVERRIDE.gradeBloom : OVERRIDE.grade;
    if (hasBloom) return OVERRIDE.bloom;
    return READS_SSAO_FADE.test(fragment) ? OVERRIDE.ssao : null;
  };

  self.__webbloxFullbrightCore = { overrideFor };

  self.__webbloxSetFullbright = on => {
    self.__webbloxFullbright = on;
    const gl = self.__webgpuGL;
    if (gl && gl.worker) gl.worker.postMessage({ type: 'fullbright', on });
  };
})();
