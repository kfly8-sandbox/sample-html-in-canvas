// Entry for attribution.html.
import before from "../../../experiments/02-attribution/before.html?raw";
import after from "../../../experiments/02-attribution/after.html?raw";

import { setupAttribution } from "../attribution";
import { guard } from "../hic";

if (guard()) void setupAttribution(document.getElementById("demo")!, before, after);
