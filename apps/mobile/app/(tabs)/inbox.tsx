import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Notifications inbox — placeholder for Phase 2. Will consume
 * GET /api/app/notifications (already token-aware via the shared client).
 */
export default function InboxScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Text style={styles.heading}>Inbox</Text>
      <View style={styles.center}>
        <Text style={styles.empty}>Notifications land here in Phase 2.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f7f7f8" },
  heading: { fontSize: 28, fontWeight: "800", paddingHorizontal: 20, paddingVertical: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: "#999", fontSize: 15 },
});
