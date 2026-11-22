import { synthesiseTemplate, synthesiseCapture, matchBiometric } from "../src/lib/biometrics";
import { sensorTemplate, sensorCapture, TEMPLATE_DIM } from "../src/lib/sensor";

const seed = "demo-sensor::pixel8-strongbox::v1";
const serverT = synthesiseTemplate(seed, "right-index");
const clientT = await sensorTemplate(seed, "right-index");
const identical = serverT.every((v, i) => Math.abs(v - clientT[i]) < 1e-12);
console.log("template dims", serverT.length, TEMPLATE_DIM, "identical:", identical);

const scores: number[] = [];
for (let i = 0; i < 12; i++) {
  const cap = await sensorCapture({ seed, fingerId: "right-index", quality: 0.95, impostor: false });
  const m = matchBiometric({ sealedTemplate: JSON.stringify(serverT), liveSample: cap, liveness: undefined, livenessEnabled: false, threshold: 0.86, lockedUntil: null });
  scores.push(+m.score.toFixed(3));
}
console.log("genuine scores", scores.join(" "));

const dry = await sensorCapture({ seed, fingerId: "right-index", quality: 0.45, impostor: false });
console.log("dry-finger score", matchBiometric({ sealedTemplate: JSON.stringify(serverT), liveSample: dry, livenessEnabled: false, liveness: undefined, threshold: 0.86, lockedUntil: null }).score.toFixed(3));
const imp = await sensorCapture({ seed, fingerId: "right-index", quality: 0.95, impostor: true });
console.log("impostor score", matchBiometric({ sealedTemplate: JSON.stringify(serverT), liveSample: imp, livenessEnabled: false, liveness: undefined, threshold: 0.86, lockedUntil: null }).score.toFixed(3));
