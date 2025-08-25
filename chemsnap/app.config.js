// app.config.js
import "dotenv/config";

export default {
  expo: {
    name: "chemsnap",
    slug: "chemsnap",
    owner: "jskord",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "chemsnap",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,

    ios: { 
          supportsTablet: true,
          bundleIdentifier: "io.jskord.chemsnap" 
        },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
      package: "io.jskord.chemsnap",
    },

    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },

    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
        },
      ],
    ],

    experiments: { typedRoutes: true },

    extra: {
      router: {},
      eas: { projectId: "ea1a77a1-a3bf-42ef-83b9-f66a3f96230a" },
      // Pulled from EAS secrets in the cloud, or .env when running locally
      VISION_API_KEY: process.env.VISION_API_KEY,
      SHEETS_WEBHOOK: process.env.SHEETS_WEBHOOK,
      SHEETS_TOKEN: process.env.SHEETS_TOKEN, // <-- fixed
    },

    runtimeVersion: { policy: "appVersion" },
    updates: {
      url: "https://u.expo.dev/ea1a77a1-a3bf-42ef-83b9-f66a3f96230a",
    },
  },
};