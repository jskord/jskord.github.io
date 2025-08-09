import React, { useState } from "react";
import { View, Text, TextInput, Button, Image, ScrollView, StyleSheet } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImageManipulator from "expo-image-manipulator";
// import { recognize } from "@cloud-ocr/react-native-ocr"; // Replace this line with actual OCR lib or API call

export default function ChemSnap() {
  const [image, setImage] = useState(null);
  const [chemicalName, setChemicalName] = useState("");
  const [volume, setVolume] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [location, setLocation] = useState("");

  const pickImage = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();

    if (!permissionResult.granted) {
      alert("Camera access is required.");
      return;
    }

    let result = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.5,
    });

    if (!result.cancelled) {
      setImage(result.uri);
      extractText(result.uri);
    }
  };

  const extractText = async (uri) => {
    try {
      // Placeholder OCR - use Tesseract.js or external API like Google Cloud Vision
      const text = await recognize(uri);

      // Parse mock OCR result
      if (text) {
        if (text.includes("Chemical")) setChemicalName("Mock Chemical");
        if (text.includes("Volume")) setVolume("100 mL");
        if (text.includes("Manufacturer")) setManufacturer("MockCorp");
      }
    } catch (error) {
      console.error("OCR Error:", error);
    }
  };

  const exportCSV = async () => {
    const csv = `Chemical Name,Volume,Manufacturer,Room Number,Location\n${chemicalName},${volume},${manufacturer},${roomNumber},${location}`;
    const fileUri = FileSystem.documentDirectory + "chemsnap.csv";

    await FileSystem.writeAsStringAsync(fileUri, csv, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    await Sharing.shareAsync(fileUri);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>ChemSnap</Text>
      <Button title="Take Photo" onPress={pickImage} />
      {image && <Image source={{ uri: image }} style={styles.image} />}

      <TextInput style={styles.input} placeholder="Chemical Name" value={chemicalName} onChangeText={setChemicalName} />
      <TextInput style={styles.input} placeholder="Volume" value={volume} onChangeText={setVolume} />
      <TextInput style={styles.input} placeholder="Manufacturer" value={manufacturer} onChangeText={setManufacturer} />
      <TextInput style={styles.input} placeholder="Room Number" value={roomNumber} onChangeText={setRoomNumber} />
      <TextInput style={styles.input} placeholder="Location" value={location} onChangeText={setLocation} />

      <Button title="Export to CSV" onPress={exportCSV} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginVertical: 10,
  },
  image: {
    width: "100%",
    height: 200,
    marginVertical: 10,
  },
  input: {
    borderColor: "#ccc",
    borderWidth: 1,
    padding: 10,
    marginVertical: 5,
    borderRadius: 5,
  },
});
