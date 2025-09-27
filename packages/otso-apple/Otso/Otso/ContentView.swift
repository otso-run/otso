//
//  ContentView.swift
//  Otso
//
//  Created by Casey Gollan on 2025-09-27.
//

import SwiftUI
import SwiftData
#if os(macOS)
import AppKit
#endif

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var items: [Item]
    @State private var selectedTab: AppTab = .posts
    @State private var showingComposer = false

    var body: some View {
        TabView(selection: $selectedTab) {
            // Compose Tab with Drafts navigation
            Tab("Compose", systemImage: "square.and.pencil", value: AppTab.compose) {
                ComposeTabView()
            }

            // Posts Tab
            Tab("Posts", systemImage: "text.badge.checkmark", value: AppTab.posts) {
                NavigationStack {
                    PlaceholderView(
                        title: "Your Posts",
                        subtitle: "View and manage published posts from your site",
                        icon: "text.badge.checkmark"
                    )
                    .navigationTitle("Posts")
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button(action: { }) {
                                Label("Refresh", systemImage: "arrow.clockwise")
                            }
                        }
                    }
                }
            }
            .badge(2)

            // Settings Tab
            Tab("Settings", systemImage: "gearshape", value: AppTab.settings) {
                NavigationStack {
                    PlaceholderView(
                        title: "Settings",
                        subtitle: "Manage accounts and preferences",
                        icon: "gearshape"
                    )
                    .navigationTitle("Settings")
                }
            }
        }
        #if os(iOS)
        .tabViewStyle(.automatic)
        #endif
    }

    private func addItem() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
            let newItem = Item(timestamp: Date())
            modelContext.insert(newItem)
        }
    }

    private func deleteItems(offsets: IndexSet) {
        withAnimation(.easeInOut) {
            for index in offsets {
                modelContext.delete(items[index])
            }
        }
    }
}

enum AppTab: String, CaseIterable, Identifiable {
    case compose
    case posts
    case settings

    var id: String { rawValue }
}

struct ComposeTabView: View {
    var body: some View {
        NavigationStack {
            PlaceholderView(
                title: "New Post",
                subtitle: "What's on your mind?",
                icon: "square.and.pencil"
            )
            .navigationTitle("Compose")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    NavigationLink(destination: DraftsListView()) {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 16, weight: .semibold))
                            Text("Drafts")
                        }
                    }
                }
            }
        }
    }
}

struct DraftsListView: View {
    @State private var drafts: [String] = ["Draft 1", "Draft 2", "Draft 3"] // Mock data for demonstration

    var body: some View {
        List {
            if !drafts.isEmpty {
                Section {
                    ForEach(drafts, id: \.self) { draft in
                        NavigationLink {
                            PlaceholderView(
                                title: "Edit: \(draft)",
                                subtitle: "Continue editing your draft",
                                icon: "doc.text"
                            )
                            .navigationTitle(draft)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(draft)
                                        .font(.headline)
                                    Text("Last edited 2 hours ago")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                            .padding(.vertical, 4)
                        }
                    }
                } header: {
                    Text("Your Drafts")
                }
            }

            Section {
                NavigationLink {
                    PlaceholderView(
                        title: "New Post",
                        subtitle: "Create a new post",
                        icon: "square.and.pencil"
                    )
                    .navigationTitle("Compose")
                } label: {
                    Label("Create New Post", systemImage: "plus.circle.fill")
                        .foregroundStyle(.tint)
                }
            }
        }
        .navigationTitle("Drafts")
        .navigationBarTitleDisplayMode(.large)
    }
}

private struct PlaceholderView: View {
    let title: String
    let subtitle: String
    var icon: String = "drop.fill"

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: icon)
                .symbolRenderingMode(.hierarchical)
                .font(.system(size: 64, weight: .medium))
                .foregroundStyle(.tint)
            Text(title)
                .font(.title2)
                .fontWeight(.semibold)
            Text(subtitle)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    ContentView()
        .modelContainer(for: Item.self, inMemory: true)
}
