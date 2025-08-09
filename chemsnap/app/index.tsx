import React, { useState } from "react";
import { View, Text, TextInput, Button, Image, ScrollView, StyleSheet, ActivityIndicator, Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

type Fields = {
  chemicalName: string;
  volume: string;
  manufacturer: string;
  roomNumber: string;   // manual
  location: string;     // manual
};

export default function ChemSnap() {
  const [imgUri, setImgUri] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>({
    chemicalName: "",
    volume: "",
    manufacturer: "",
    roomNumber: "",
    location: "",
  });
  const [busy, setBusy] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Camera access is required.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setImgUri(uri);
      await runOCR(uri);
    }
  };

  const runOCR = async (uri: string) => {
    setBusy(true);
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

      // ⬇️ Get a free key at https://ocr.space/ocrapi
      const OCR_API_KEY = "PASTE_YOUR_OCR_SPACE_API_KEY_HERE";

      const form = new FormData();
      form.append("base64Image", `data:image/jpg;base64,${b64}`);
      form.append("language", "eng");
      form.append("isTable", "false");

      const resp = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: { apikey: OCR_API_KEY },
        body: form as any,
      });

      const data = await resp.json();
      const text: string =
        data?.ParsedResults?.[0]?.ParsedText?.toString() ?? "";

      const parsed = parseLabel(text);
      setFields((prev) => ({ ...prev, ...parsed }));
    } catch (e: any) {
      Alert.alert("OCR error", e?.message ?? "Failed to run OCR.");
    } finally {
      setBusy(false);
    }
  };

  // Heuristics: grab likely volume (units), manufacturer (Corp/Inc/Lab/Scientific/etc), and a name candidate.
  const parseLabel = (raw: string): Partial<Fields> => {
    const text = raw.replace(/\r/g, "").trim();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    // Volume
    const volRegex = /\b(\d+(?:[.,]\d+)?)\s*(mL|ml|L|l|gal|oz|fl\.?\s*oz|µL|UL)\b/i;
    const volumeMatch = text.match(volRegex)?.[0] ?? "";

    // Manufacturer
    const makerRegex = /\b([A-Z][A-Za-z&\-\s]+(?:Labs?|Laboratories|Scientific|Sciences?|Industr(y|ies)|Corporation|Corp\.?|Company|Co\.?|LLC|Ltd\.?))\b/;
    let manufacturer = "";
    for (const l of lines) {
      const m = l.match(makerRegex);
      if (m) { manufacturer = m[0]; break; }
    }
    if (!manufacturer && lines.length) {
      // fallback: last line that contains letters and not mostly digits/units
      const cand = [...lines].reverse().find((l) => l.length > 3 && !/\d{3,}/.test(l));
      manufacturer = cand ?? "";
    }

    // Chemical name (first strong line not containing units/catalog words)
    const badWords = /(mL|ml|L|gal|oz|Cat\.?|CAS|Lot|Ref|No\.?|#|%|wt|vol)/i;
    let chemicalName = lines.find((l) => l.length > 2 && !badWords.test(l)) ?? "";
    // Prefer a line with 1–4 words (typical product names)
    const compact = lines.find((l) => l.split(/\s+/).length <= 4 && !badWords.test(l));
    if (compact) chemicalName = compact;

    return { chemicalName, volume: volumeMatch, manufacturer };
  };

  const exportCSV = async () => {
    const header = "Chemical Name,Volume,Manufacturer,Room Number,Location\n";
    const csvRow = [
      fields.chemicalName,
      fields.volume,
      fields.manufacturer,
      fields.roomNumber,
      fields.location,
    ]
      .map((v) => `"${(v || "").replace(/\"/g, '""')}"`)
      .join(",");

    const csv = header + csvRow + "\n";
    const fileUri = FileSystem.documentDirectory + "chemsnap.csv";
    await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(fileUri);
  };

  const set = (k: keyof Fields, v: string) => setFields((prev) => ({ ...prev, [k]: v }));

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>ChemSnap</Text>

      <Button title="Pick / Take Photo" onPress={pickImage} />
      {imgUri ? <Image source={{ uri: imgUri }} style={styles.image} /> : null}

      {busy ? <ActivityIndicator style={{ marginVertical: 12 }} /> : null}

      <Text style={styles.label}>1. Chemical Name</Text>
      <TextInput style={styles.input} value={fields.chemicalName} onChangeText={(t) => set("chemicalName", t)} placeholder="e.g., Acetone" />

      <Text style={styles.label}>2. Volume</Text>
      <TextInput style={styles.input} value={fields.volume} onChangeText={(t) => set("volume", t)} placeholder="e.g., 500 mL" />

      <Text style={styles.label}>3. Manufacturer</Text>
      <TextInput style={styles.input} value={fields.manufacturer} onChangeText={(t) => set("manufacturer", t)} placeholder="e.g., Fisher Scientific" />

      <Text style={styles.label}>4. Room Number</Text>
      <TextInput style={styles.input} value={fields.roomNumber} onChangeText={(t) => set("roomNumber", t)} placeholder="e.g., B214" />

      <Text style={styles.label}>5. Location</Text>
      <TextInput style={styles.input} value={fields.location} onChangeText={(t) => set("location", t)} placeholder="e.g., Lab A, Shelf 3" />

      <Button title="Save as CSV & Share" onPress={exportCSV} />
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 8 },
  title: { fontSize: 22, fontWeight: "600", marginBottom: 8 },
  image: { width: "100%", height: 260, marginVertical: 10, borderRadius: 8 },
  label: { marginTop: 8, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, backgroundColor: "#fff" },
});

