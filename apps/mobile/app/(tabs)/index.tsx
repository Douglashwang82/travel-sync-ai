import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { endpoints, type SessionResponse, type SessionTripSummary } from "@travel-sync/shared";
import { api } from "@/api/client";
import { useAuth } from "@/auth/auth-context";

function dateRange(trip: SessionTripSummary): string {
  if (!trip.startDate) return "Dates TBD";
  return trip.endDate && trip.endDate !== trip.startDate
    ? `${trip.startDate} → ${trip.endDate}`
    : trip.startDate;
}

export default function TripsScreen() {
  const { signOut } = useAuth();
  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ["session"],
    queryFn: () => api.get<SessionResponse>(endpoints.session),
  });

  const renderItem = useCallback(
    ({ item }: { item: SessionTripSummary }) => (
      <Pressable style={styles.card}>
        <Text style={styles.cardTitle}>
          {item.destinationName ?? "Untitled trip"}
        </Text>
        <Text style={styles.cardMeta}>{dateRange(item)}</Text>
        <Text style={styles.cardMeta}>
          {item.itemCount} item{item.itemCount === 1 ? "" : "s"} · {item.status}
        </Text>
      </Pressable>
    ),
    []
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.heading}>Trips</Text>
        <Pressable onPress={signOut} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>Couldn&apos;t load your trips.</Text>
          <Pressable onPress={() => refetch()}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data?.trips ?? []}
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>No trips yet.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f7f7f8" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  heading: { fontSize: 28, fontWeight: "800" },
  signOut: { color: "#888", fontSize: 15 },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: 18, fontWeight: "700" },
  cardMeta: { fontSize: 14, color: "#666" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  error: { color: "#c00", fontSize: 15 },
  retry: { color: "#06c", fontSize: 15, fontWeight: "600" },
  empty: { color: "#999", fontSize: 15 },
});
