import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.secretroom.app",
  appName: "Secret Room",
  webDir: "../web/out",
  bundledWebRuntime: false,
  plugins: {
    SplashScreen: {
      launchAutoHide: true
    }
  },
  android: {
    allowMixedContent: false,
    captureInput: true
  },
  ios: {
    contentInset: "automatic"
  }
};

export default config;
