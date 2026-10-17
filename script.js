const form = document.querySelector("#listing-form");
const studio = document.querySelector("#studio");
const resultTitle = document.querySelector("#result-title");
const emptyResult = document.querySelector("#empty-result");
const generatedResult = document.querySelector("#generated-result");
const loadingResult = document.querySelector("#loading-result");
const modePill = document.querySelector("#mode-pill");
const toast = document.querySelector("#toast");
const photoInput = document.querySelector("#photo-input");
const photoPreviews = document.querySelector("#photo-previews");
const powerTypes = {
  vintage: { label: "Vintage", title: "Vintage {name} — curated pre-loved find", description: "A standout {name} with plenty of character. Carefully photographed and ready for its next chapter. Please review the photos for the full condition story, and message with any questions before ordering.", tags: "vintage, pre-loved, curated, one of a kind, thrift find", checklist: "Confirm measurements\nAdd material / brand\nDescribe every visible flaw", score: 91 },
  handmade: { label: "Handmade", title: "Handmade {name} — made in small batches", description: "A thoughtfully made {name}, created in a small batch with care. Each piece has the tiny details that make handmade goods feel personal. See the photos and notes for the complete product story.", tags: "handmade, small batch, artisan, thoughtful gift, maker", checklist: "Add materials\nAdd dimensions\nShare care instructions", score: 94 },
  food: { label: "Food", title: "{name} — small-batch goodness, made to share", description: "Meet {name}, made in small batches for the moments that deserve something special. Please review the ingredients, allergens, pickup or delivery details, and best-before information before ordering.", tags: "small batch, local food, gift, made to order, pantry", checklist: "Confirm ingredients\nAdd allergens\nAdd serving / storage info", score: 89 },
  "print-on-demand": { label: "Print-on-demand", title: "{name} — original design for everyday life", description: "Bring a little more personality to your everyday with {name}. A bold, giftable design made for people who like their things to say something. Add your size, color, and fulfillment details before publishing.", tags: "original design, gift idea, graphic, independent artist, merch", checklist: "Add size guide\nConfirm print area\nAdd color options", score: 93 },
  other: { label: "Independent seller", title: "{name} — a good find from an independent seller", description: "A carefully described {name}, listed by an independent seller. The details below are designed to help a buyer decide quickly and confidently — add anything unique before you publish.", tags: "independent seller, unique find, small business, gift idea", checklist: "Add dimensions\nDescribe condition\nConfirm fulfillment details", score: 88 },
};
let lastOutput = "";
let demoMode = true;

function selectedType() { return document.querySelector('input[name="productType"]:checked').value; }
function showToast(message) { toast.textContent = message; toast.classList.add("show"); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3000); }
function adaptType() {
  document.querySelectorAll(".type-option").forEach((option) => option.classList.toggle("selected", option.querySelector("input").checked));
}
function collectInput() {
  return { type: selectedType(), name: document.querySelector("#product-name").value.trim(), platform: document.querySelector("#platform").value, tone: document.querySelector("#tone").value, details: document.querySelector("#details").value.trim() };
}
function fillTemplate(input) {
  const profile = powerTypes[input.type] || powerTypes.other;
  const name = input.name || "your product";
  const detail = input.details ? ` ${input.details}` : "";
  const title = profile.title.replace("{name}", name);
  const description = `${profile.description.replace("{name}", name)}${detail ? ` Seller notes:${detail}` : ""}`;
  return { title, description, tags: profile.tags, checklist: profile.checklist, score: profile.score };
}
function renderOutput(output, input, source = "DEMO MODE") {
  resultTitle.textContent = output.title;
  document.querySelector("#quality-score").textContent = output.qualityScore ?? output.score;
  document.querySelector("#output-title").textContent = output.title;
  document.querySelector("#output-description").textContent = output.description;
  document.querySelector("#output-tags").textContent = output.tags;
  document.querySelector("#output-checklist").textContent = output.checklist;
  modePill.textContent = source;
  emptyResult.classList.add("hidden");
  loadingResult.classList.add("hidden");
  generatedResult.classList.remove("hidden");
  lastOutput = `${output.title}\n\n${output.description}\n\nTags: ${output.tags}\n\nBuyer checklist:\n${output.checklist}`;
  studio.scrollIntoView({ behavior: "smooth", block: "start" });
}
function setLoading(isLoading, input) {
  loadingResult.classList.toggle("hidden", !isLoading);
  emptyResult.classList.toggle("hidden", isLoading);
  generatedResult.classList.add("hidden");
  if (isLoading) {
    resultTitle.textContent = input.name;
    modePill.textContent = "GENERATING";
  }
}
async function tryHostedModel(input) {
  const response = await fetch("/api/generate-listing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Hosted model request failed" }));
    throw new Error(error.error || "Hosted model request failed");
  }
  return response.json();
}
async function generateListing() {
  const input = collectInput();
  if (!input.name) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Writing your listing...";
  setLoading(true, input);
  try {
    const output = await tryHostedModel(input);
    demoMode = false;
    renderOutput(output, input, output.modelLabel || "HOSTED OPEN MODEL");
    showToast(`Generated with ${output.modelLabel || "the hosted open model"}.`);
  } catch (error) {
    demoMode = true;
    renderOutput(fillTemplate(input), input);
    console.error("Hosted listing generation failed:", error);
    showToast(`Demo listing ready: hosted models are busy. ${error.message || "Try again shortly."}`);
  } finally {
    button.disabled = false;
    button.innerHTML = "Generate my listing <span aria-hidden=\"true\">↗</span>";
  }
}
document.querySelectorAll('input[name="productType"]').forEach((input) => input.addEventListener("change", adaptType));
photoInput.addEventListener("change", () => {
  photoPreviews.innerHTML = "";
  [...photoInput.files].slice(0, 6).forEach((file) => {
    const image = document.createElement("img");
    image.alt = `${file.name} preview`;
    image.src = URL.createObjectURL(file);
    photoPreviews.appendChild(image);
  });
});
form.addEventListener("submit", (event) => { event.preventDefault(); generateListing(); });
document.querySelector("#start-listing").addEventListener("click", () => studio.scrollIntoView({ behavior: "smooth" }));
document.querySelector("#new-listing").addEventListener("click", () => { form.reset(); photoPreviews.innerHTML = ""; adaptType(); emptyResult.classList.remove("hidden"); generatedResult.classList.add("hidden"); studio.scrollIntoView({ behavior: "smooth" }); });
document.querySelector("#regenerate").addEventListener("click", generateListing);
document.querySelector("#copy-listing").addEventListener("click", async () => { await navigator.clipboard.writeText(lastOutput); showToast("Listing copied to your clipboard."); });
adaptType();
