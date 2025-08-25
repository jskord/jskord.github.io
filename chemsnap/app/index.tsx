import React, { useRef, useState } from "react";
import {
  Alert,
  ActionSheetIOS,
  ActivityIndicator,
  Button,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

// Config values pulled from app.config.js → extra
const { VISION_API_KEY, SHEETS_WEBHOOK, SHEETS_TOKEN } =
  (Constants.expoConfig?.extra as any) || {};


/* ============================= TYPES ============================= */
type Fields = {
  chemicalName: string;
  containerVolume: string; // numeric only
  volumeUnits: string;     // mL, L, µL, oz, gal
  quantity: string;
  manufacturer: string;
  casNumber: string;
  hazardWarning: string;
  expirationDate: string;
  notes: string;
  roomNumber: string;
  location: string;
};

type FourKeys = "chemicalName" | "manufacturer" | "containerVolume" | "volumeUnits";

/* ============================= SMART OCR HELPERS ============================= */
const KNOWN_MANUFACTURERS = [
  "fisher scientific","thermo fisher","qiagen","sigma","sigma-aldrich","merck","millipore",
  "ambion","agilent","promega","bio-rad","vwr","new england biolabs","neb","emd","omnipur",
  "corning","greiner","beckman","illumina","biorad","takara","santa cruz","ge healthcare","cytiva",
  "aqua solutions","alfa aesar","acros","tci","spectrum"
];

const STOP_PHRASES = [
  /temperature/i,/store/i,/keep/i,/avoid/i,/protect/i,/warning/i,/caution/i,/hazard/i,/danger/i,
  /attention/i,/instruction/i,/disposal/i,/msds/i,/general storage/i,
  /\bpH\b/i,/\bcat\.?\b/i,/\bcatalog\b/i,/\bref\b/i,/\blot\b/i,/\bno\.?\b/i,/\b#\b/i,/\bsku\b/i,
  /\bcas\b/i
];

const CHEM_HINTS = [
  /buffer/i,/solution/i,/acid/i,/base/i,/reagent/i,/elution/i,/ethanol/i,/isopropyl/i,
  /methanol/i,/acetone/i,/sodium/i,/chloride/i,/tris/i,/edta/i,/pbs/i,/\bwater\b/i
];

const CHEM_STRONG_BOOST = [
  /(total\s+organic\s+carbon|^TOC\b)/i, /\b(std|standard)\b/i, /\b(ppm|ppb|mg\/?L|g\/?L)\b/i, /\b(w\/w|w\/v|v\/v)\b/i
];

const linesFrom = (raw: string) =>
  raw.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);

const uniqueTop = (arr: string[], n = 6) => {
  const seen = new Set<string>(); const out: string[] = [];
  for (const s of arr) { const k = s.toLowerCase(); if (!seen.has(k) && s) { seen.add(k); out.push(s); } if (out.length >= n) break; }
  return out;
};

const normalizeUnits = (u: string) => {
  const s = u.trim().toLowerCase().replace(/\s+/g, "");
  if (s === "ul" || s === "µl" || s === "μl") return "µL";
  if (s === "ml") return "mL";
  if (s === "l") return "L";
  if (s === "oz" || s === "floz" || s === "fl.oz") return "oz";
  if (s === "gal" || s === "gallon" || s === "gallons") return "gal";
  return u;
};

const getVolumeMatches = (raw: string) => {
  const re1 = /\b(\d+(?:[.,]\d+)?)\s*(µL|uL|μL|mL|L|fl\.?\s*oz|oz|gal)\b/gi;
  const re2 = /\b(\d+(?:[.,]\d+)?)(µL|uL|μL|mL|L|oz|gal)\b/gi;
  const arr: { vol: string; unit: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re1.exec(raw))) arr.push({ vol: m[1].replace(",", "."), unit: normalizeUnits(m[2].replace(/\s+/g, "")) });
  while ((m = re2.exec(raw))) arr.push({ vol: m[1].replace(",", "."), unit: normalizeUnits(m[2].replace(/\s+/g, "")) });
  return arr;
};

const getVolumeCandidates = (raw: string) => uniqueTop(getVolumeMatches(raw).map((x) => x.vol), 6);
const getUnitCandidates   = (raw: string) => uniqueTop(getVolumeMatches(raw).map((x) => x.unit), 6);

const scoreChemicalLine = (line: string) => {
  let s = 0; if (STOP_PHRASES.some((r) => r.test(line))) s -= 4;
  const text = line.trim(); const len = text.length;
  if (/^(solution|solutions|aqueous|water|buffer)$/i.test(text)) s -= 2;
  if (len >= 3 && len <= 70) s += 1; else s -= 2;
  const words = text.split(/\s+/); if (words.length >= 2 && words.length <= 8) s += 2;
  if (CHEM_HINTS.some((r) => r.test(text))) s += 2;
  if (CHEM_STRONG_BOOST.some((r) => r.test(text))) s += 5;
  if (/\b\d+(?:[.,]\d+)?\s*(ppm|ppb|mg\/?L|g\/?L)\b/i.test(text)) s += 3;
  if (/\b(w\/w|w\/v|v\/v)\b/i.test(text)) s += 2;
  const digits = (text.match(/\d/g) || []).length; if (digits / Math.max(1, len) > 0.5) s -= 1;
  return s;
};

const scoreManufacturerLine = (line: string) => {
  let s = 0; const lc = line.toLowerCase();
  if (KNOWN_MANUFACTURERS.some((k) => lc.includes(k))) s += 4;
  if (/[®™]/.test(line)) s += 2;
  if (/\b(inc\.?|corp\.?|co\.?|ltd\.?|gmbh|llc)\b/i.test(line)) s += 2;
  const digits = (line.match(/\d/g) || []).length; if (digits >= 4) s -= 1;
  if (/[A-Z][a-z]+[A-Z][a-z]+/.test(line)) s += 1;
  return s;
};

const getChemicalNameCandidates = (raw: string) => {
  const L = linesFrom(raw); const combos: string[] = [];
  for (let i = 0; i < L.length; i++) { combos.push(L[i]); if (i + 1 < L.length) combos.push(`${L[i]} ${L[i + 1]}`.replace(/\s{2,}/g, " ").trim()); }
  const scored = combos.map((line) => ({ line, score: scoreChemicalLine(line) }))
    .filter((x) => /[A-Za-z]/.test(x.line) && x.score > 0)
    .sort((a, b) => b.score - a.score);
  return uniqueTop(scored.map((x) => x.line), 6);
};

const getManufacturerCandidates = (raw: string) => {
  const scored = linesFrom(raw).map((line) => ({ line, score: scoreManufacturerLine(line) }))
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 0);
  return uniqueTop(scored.map((x) => x.line), 6);
};

/* ======== NEW: CAS & Expiration parsers ======== */
const CAS_RE = /\b\d{2,7}-\d{2}-\d\b/;

const parseCAS = (text: string) => {
  const m = (text || "").match(CAS_RE);
  return m ? m[0] : "";
};

const parseExpiration = (text: string) => {
  const t = (text || "").trim();

  // YYYY-MM-DD or YYYY/MM/DD
  let m = t.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;

  // MM-DD-YYYY or MM/DD/YYYY
  m = t.match(/\b(0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])[-/](20\d{2})\b/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;

  // DD-MM-YYYY or DD/MM/YYYY
  m = t.match(/\b(0?[1-9]|[12]\d|3[01])[-/](0?[1-9]|1[0-2])[-/](20\d{2})\b/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;

  return "";
};

/* ============================= COMPONENT ============================= */
export default function ChemSnap() {
  // Image & OCR state
  const [imgUri, setImgUri] = useState<string | null>(null);
  const [ocrLines, setOcrLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Fields
  const [fields, setFields] = useState<Fields>({
    chemicalName: "",
    containerVolume: "",
    volumeUnits: "",
    quantity: "",
    manufacturer: "",
    casNumber: "",
    hazardWarning: "",
    expirationDate: "",
    notes: "",
    roomNumber: "",
    location: "",
  });
  const set = (k: keyof Fields, v: string) => setFields((p) => ({ ...p, [k]: v }));

  // Scroll control
  const scrollRef = useRef<ScrollView>(null);

  /* ============================= IMAGE PICK ============================= */
  const pickImage = async () => {
    Alert.alert("Add photo", "Choose a source", [
      { text: "Camera", onPress: pickFromCamera },
      { text: "Photo Library", onPress: pickFromLibrary },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const pickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission needed", "Camera access is required.");
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled) { const uri = result.assets[0].uri; setImgUri(uri); await runVisionOCR(uri); }
  };

  const pickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission needed", "Photo library access is required.");
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled) { const uri = result.assets[0].uri; setImgUri(uri); await runVisionOCR(uri); }
  };

  /* ============================= OCR (Google Vision) ============================= */
  const runVisionOCR = async (uri: string) => {
    if (!VISION_API_KEY) {
      Alert.alert("Vision API", "VISION_API_KEY missing. Add it to extra in app.config.js and publish.");
      return;
    }
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const body = { requests: [{ image: { content: b64 }, features: [{ type: "TEXT_DETECTION" }] }] };

      const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        Alert.alert("Vision error", `${resp.status}: ${txt.slice(0, 200)}`);
        setBusy(false);
        return;
      }

      const data = await resp.json();
      const text: string =
        data?.responses?.[0]?.fullTextAnnotation?.text?.toString() ??
        data?.responses?.[0]?.textAnnotations?.[0]?.description?.toString() ?? "";
      setOcrLines(linesFrom(text));

      // bring the OCR section into view
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: true }));
    } catch (e: any) {
      Alert.alert("OCR error", e?.message ?? "Failed to run Vision OCR.");
    } finally {
      setBusy(false);
    }
  };

  /* ================= SUGGEST (Top 6 + Replace/Append) ================= */
  const joinOCR = () => ocrLines.join("\n");

  // Existing helper for 4 core fields (kept for compatibility)
  const applyValueWithChoice = (field: FourKeys, candidate: string) => {
    const current = fields[field] || "";
    if (!current) return set(field, candidate);
    Alert.alert("Field not empty", `Add "${candidate}" to the end, or replace the current value?`, [
      { text: "Replace", onPress: () => set(field, candidate) },
      {
        text: "Append to end",
        onPress: () => {
          const sep = field === "containerVolume" || field === "volumeUnits" ? ", " : " | ";
          set(field, current + sep + candidate);
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // NEW: generic helper so we can assign CAS/Expiration too
  const applyValueWithChoiceAny = (field: keyof Fields, candidate: string, sepFallback: string = " | ") => {
    const current = fields[field] || "";
    if (!current) return set(field, candidate);
    Alert.alert("Field not empty", `Add "${candidate}" to the end, or replace the current value?`, [
      { text: "Replace", onPress: () => set(field, candidate) },
      { text: "Append to end", onPress: () => set(field, current + sepFallback + candidate) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const pickFromList = (title: string, candidates: string[], field: FourKeys) => {
    if (!candidates.length) return Alert.alert(title, "No suggestions found.");
    const items = candidates.slice(0, 6);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, options: [...items, "Cancel"], cancelButtonIndex: items.length },
        (i) => { if (i >= 0 && i < items.length) applyValueWithChoice(field, items[i]); }
      );
    } else {
      Alert.alert(title, "Pick a suggestion", [
        ...items.map((label) => ({ text: label, onPress: () => applyValueWithChoice(field, label) })),
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const suggestForField = (field: FourKeys) => {
    if (ocrLines.length === 0) return Alert.alert("No OCR", "Add/take a photo first.");
    const text = joinOCR();
    let cands: string[] = [];
    if (field === "chemicalName")    cands = getChemicalNameCandidates(text);
    if (field === "manufacturer")    cands = getManufacturerCandidates(text);
    if (field === "containerVolume") cands = getVolumeCandidates(text);
    if (field === "volumeUnits")     cands = getUnitCandidates(text);

    pickFromList(field === "containerVolume" ? "Volume"
                 : field === "volumeUnits"  ? "Volume Units"
                 : field === "chemicalName" ? "Chemical Name" : "Manufacturer",
                 cands, field);
  };

  /* ============ Tap any OCR line → assign to field ============ */
  const parseVolumeAndUnit = (text: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    const m = t.match(/\b(\d+(?:[.,]\d+)?)\s*(µL|uL|μL|mL|ml|L|l|oz|fl\.?\s*oz|gal)\b/i)
             || t.match(/\b(\d+(?:[.,]\d+)?)(µL|uL|μL|mL|ml|L|l|oz|gal)\b/i);
    if (!m) return { value: "", unit: "" };
    const rawVal = m[1].replace(",", ".");
    let unit = m[2];
    if (/^µ?u?μ?l$/i.test(unit)) unit = "µL";
    else if (/^ml$/i.test(unit)) unit = "mL";
    else if (/^l$/i.test(unit)) unit = "L";
    else if (/^gal$/i.test(unit)) unit = "gal";
    else if (/^fl\.?\s*oz$/i.test(unit) || /^oz$/i.test(unit)) unit = "oz";
    return { value: rawVal, unit };
  };

  // UPDATED: include CAS # and Expiration Date in the action sheet
  const presentAssignMenu = (line: string) => {
  const volParsed = parseVolumeAndUnit(line);
  const casParsed = parseCAS(line);
  const expParsed = parseExpiration(line);

  const assign = (target:
    | "chemical" | "manufacturer" | "volume" | "unit" | "cas" | "exp") => {
    if (target === "chemical")     return applyValueWithChoice("chemicalName", line);
    if (target === "manufacturer") return applyValueWithChoice("manufacturer", line);
    if (target === "volume") {
      const { value } = parseVolumeAndUnit(line);
      return applyValueWithChoice("containerVolume", value || line);
    }
    if (target === "unit") {
      const { unit } = parseVolumeAndUnit(line);
      return applyValueWithChoice("volumeUnits", unit || line);
    }
    if (target === "cas") {
      const cas = parseCAS(line);
      return applyValueWithChoiceAny("casNumber", cas || line);
    }
    if (target === "exp") {
      const exp = parseExpiration(line);
      return applyValueWithChoiceAny("expirationDate", exp || line);
    }
  };

  if (Platform.OS === "ios") {
    // iOS: one sheet with all options
    const options = [
      "Set as Chemical Name",
      "Set as Manufacturer",
      `Set as Volume${volParsed.value ? ` (${volParsed.value})` : ""}`,
      `Set as Volume Units${volParsed.unit ? ` (${volParsed.unit})` : ""}`,
      `Set as CAS #${casParsed ? ` (${casParsed})` : ""}`,
      `Set as Expiration Date${expParsed ? ` (${expParsed})` : ""}`,
      "Cancel",
    ];
    const actions: Array<() => void> = [
      () => assign("chemical"),
      () => assign("manufacturer"),
      () => assign("volume"),
      () => assign("unit"),
      () => assign("cas"),
      () => assign("exp"),
      () => {},
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: line, options, cancelButtonIndex: options.length - 1 },
      (i) => { if (i != null && i >= 0 && i < options.length - 1) actions[i](); }
    );
    return;
  }

  // ANDROID: keep <=3 buttons per alert with a two-step menu
  Alert.alert("Assign OCR line", `"${line}"`, [
    { text: "Chemical", onPress: () => assign("chemical") },
    { text: "Manufacturer", onPress: () => assign("manufacturer") },
    {
      text: "More…",
      onPress: () => {
        Alert.alert("Assign to…", `"${line}"`, [
          { text: `Volume${volParsed.value ? ` (${volParsed.value})` : ""}`, onPress: () => assign("volume") },
          { text: `Units${volParsed.unit ? ` (${volParsed.unit})` : ""}`, onPress: () => assign("unit") },
          {
            text: "More…",
            onPress: () => {
              Alert.alert("Assign to…", `"${line}"`, [
                { text: `CAS #${casParsed ? ` (${casParsed})` : ""}`, onPress: () => assign("cas") },
                { text: `Expiration${expParsed ? ` (${expParsed})` : ""}`, onPress: () => assign("exp") },
                { text: "Cancel", style: "cancel" },
              ]);
            }
          },
        ]);
      }
    },
  ]);
};


  /* ============================= CSV EXPORT ============================= */
  const exportCSV = async () => {
    const header = [
      "chemical name","container volume","volume units","quantity",
      "total volume","total volume units",
      "manufacturer","CAS #","Hazard Warning","Expiration Date","Notes",
      "room number","location","timestamp",
    ].join(",");

    const row = [
      fields.chemicalName, fields.containerVolume, fields.volumeUnits, fields.quantity,
      "", "", // calculated in sheet
      fields.manufacturer, fields.casNumber, fields.hazardWarning, fields.expirationDate, fields.notes,
      fields.roomNumber, fields.location, new Date().toISOString(),
    ].map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",");

    const csv = header + "\n" + row + "\n";
    const fileUri = FileSystem.documentDirectory + "chemsnap.csv";
    await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(fileUri);
  };

  /* ============================= SHEETS SUBMIT ============================= */
  const sendToGoogleSheets = async () => {
    if (!SHEETS_WEBHOOK) return Alert.alert("Sheets error", "SHEETS_WEBHOOK is not set in extra.");
    setBusy(true);
    try {
      const payload = {
        token: SHEETS_TOKEN,
        chemicalName: fields.chemicalName,
        containerVolume: fields.containerVolume,
        volumeUnits: fields.volumeUnits,
        quantity: fields.quantity,
        manufacturer: fields.manufacturer,
        casNumber: fields.casNumber,
        hazardWarning: fields.hazardWarning,
        expirationDate: fields.expirationDate,
        notes: fields.notes,
        roomNumber: fields.roomNumber,
        location: fields.location,
        timestamp: new Date().toISOString(),
      };

      const res = await fetch(SHEETS_WEBHOOK, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Failed to add row");
      Alert.alert("Saved", "Row added to Google Sheet.");
    } catch (e: any) {
      Alert.alert("Sheets error", e?.message || "Failed to send to Google Sheet.");
    } finally {
      setBusy(false);
    }
  };

  /* ============================= UI ============================= */
  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>ChemSnap</Text>

      <Button title="Pick / Take Photo" onPress={pickImage} />
      {imgUri ? <Image source={{ uri: imgUri }} style={styles.image} /> : null}
      {busy ? <ActivityIndicator style={{ marginVertical: 12 }} /> : null}

      {/* --- OCR lines FIRST (tap to assign) --- */}
      {ocrLines.length > 0 && (
        <View style={{ marginTop: 12, marginBottom: 8 }}>
          <Text style={[styles.label, { marginBottom: 6 }]}>OCR Lines (tap to assign)</Text>
          <View style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 8, overflow: "hidden" }}>
            {ocrLines.map((ln, idx) => (
              <TouchableOpacity
                key={`${idx}-${ln}`}
                onPress={() => presentAssignMenu(ln)}
                style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: idx % 2 ? "#fafafa" : "#fff" }}
              >
                <Text style={{ color: "#333" }}>{ln}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* divider */}
      {ocrLines.length > 0 && <View style={{ height: 1, backgroundColor: "#eee", marginVertical: 8 }} />}

      {/* 1. Chemical Name + Suggest */}
      <View style={styles.rowHeader}>
        <Text style={styles.label}>1. Chemical Name</Text>
        <TouchableOpacity style={styles.suggest} onPress={() => suggestForField("chemicalName")}>
          <Text style={styles.suggestText}>Suggest</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={fields.chemicalName}
        onChangeText={(t) => set("chemicalName", t)}
        placeholder="e.g., Total Organic Carbon Std 2000 ppm w/w"
        autoCapitalize="none"
        blurOnSubmit={false}
      />

      {/* 2. Manufacturer + Suggest */}
      <View style={styles.rowHeader}>
        <Text style={styles.label}>2. Manufacturer</Text>
        <TouchableOpacity style={styles.suggest} onPress={() => suggestForField("manufacturer")}>
          <Text style={styles.suggestText}>Suggest</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={fields.manufacturer}
        onChangeText={(t) => set("manufacturer", t)}
        placeholder="e.g., Aqua Solutions / EMD / OmniPur"
        autoCapitalize="none"
        blurOnSubmit={false}
      />

      {/* 3. Volume + Suggest */}
      <View style={styles.rowHeader}>
        <Text style={styles.label}>3. Volume</Text>
        <TouchableOpacity style={styles.suggest} onPress={() => suggestForField("containerVolume")}>
          <Text style={styles.suggestText}>Suggest</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={fields.containerVolume}
        onChangeText={(t) => set("containerVolume", t)}
        placeholder="e.g., 500"
        keyboardType="numeric"
        blurOnSubmit={false}
      />

      {/* 4. Volume Units + Suggest */}
      <View style={styles.rowHeader}>
        <Text style={styles.label}>4. Volume Units</Text>
        <TouchableOpacity style={styles.suggest} onPress={() => suggestForField("volumeUnits")}>
          <Text style={styles.suggestText}>Suggest</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        value={fields.volumeUnits}
        onChangeText={(t) => set("volumeUnits", t)}
        placeholder="e.g., mL / L / µL / oz / gal"
        autoCapitalize="none"
        blurOnSubmit={false}
      />

      {/* Quantity */}
      <Text style={styles.label}>Quantity</Text>
      <TextInput
        style={styles.input}
        value={fields.quantity}
        onChangeText={(t) => set("quantity", t)}
        placeholder="e.g., 12"
        keyboardType="numeric"
        blurOnSubmit={false}
      />

      {/* CAS # */}
      <Text style={styles.label}>CAS #</Text>
      <TextInput
        style={styles.input}
        value={fields.casNumber}
        onChangeText={(t) => set("casNumber", t)}
        placeholder="e.g., 7732-18-5"
        autoCapitalize="none"
        blurOnSubmit={false}
      />

      {/* Hazard Warning */}
      <Text style={styles.label}>Hazard Warning</Text>
      <TextInput
        style={styles.input}
        value={fields.hazardWarning}
        onChangeText={(t) => set("hazardWarning", t)}
        placeholder="e.g., Corrosive, Flammable"
        autoCapitalize="none"
        blurOnSubmit={false}
      />

      {/* Expiration Date */}
      <Text style={styles.label}>Expiration Date</Text>
      <TextInput
        style={styles.input}
        value={fields.expirationDate}
        onChangeText={(t) => set("expirationDate", t)}
        placeholder="e.g., 2026-12-31"
        blurOnSubmit={false}
      />

      {/* Notes */}
      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={[styles.input, { minHeight: 70 }]}
        value={fields.notes}
        onChangeText={(t) => set("notes", t)}
        placeholder="Freeform notes"
        multiline
        blurOnSubmit={false}
      />

      {/* Room Number */}
      <Text style={styles.label}>Room Number</Text>
      <TextInput
        style={styles.input}
        value={fields.roomNumber}
        onChangeText={(t) => set("roomNumber", t)}
        placeholder="e.g., B214"
        autoCapitalize="none"
        blurOnSubmit={false}
      />

      {/* Location */}
      <Text style={styles.label}>Location</Text>
      <TextInput
        style={styles.input}
        value={fields.location}
        onChangeText={(t) => set("location", t)}
        placeholder="e.g., Lab A, Shelf 3"
        autoCapitalize="none"
        blurOnSubmit={false}
      />

      <View style={{ height: 12 }} />
      <Button title="Save as CSV & Share" onPress={exportCSV} />
      <View style={{ height: 8 }} />
      <Button title="Send to Google Sheet" onPress={sendToGoogleSheets} />
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

/* ============================= STYLES ============================= */
const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 8 },
  title: { fontSize: 22, fontWeight: "600", marginBottom: 8 },
  image: { width: "100%", height: 260, marginVertical: 10, borderRadius: 8 },
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  label: { fontWeight: "600" },
  suggest: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "#e7f0ff", borderRadius: 6 },
  suggestText: { color: "#1f6feb", fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, backgroundColor: "#fff", marginTop: 6 },
});
