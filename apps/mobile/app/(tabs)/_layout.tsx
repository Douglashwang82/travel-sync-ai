import { Tabs } from "expo-router";

/**
 * Native bottom tab bar. Phase 1 ships Trips + Inbox; Map and Profile follow.
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: "#111" }}>
      <Tabs.Screen name="index" options={{ title: "Trips" }} />
      <Tabs.Screen name="inbox" options={{ title: "Inbox" }} />
    </Tabs>
  );
}
