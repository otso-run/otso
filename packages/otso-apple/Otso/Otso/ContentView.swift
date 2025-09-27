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
    @State private var selectedTab: AppTab = .compose
    @State private var showingComposer = false
    @State private var selectedPostType: IndiePostType = .note

    var body: some View {
        TabView(selection: $selectedTab) {
            // Compose Tab with Drafts navigation
            Tab("Compose", systemImage: "square.and.pencil", value: AppTab.compose) {
                ComposeTabView(selectedPostType: $selectedPostType)
            }
            #if os(iOS)
            .contextMenu {
                ForEach(IndiePostType.allCases, id: \.self) { type in
                    Button {
                        selectedPostType = type
                        selectedTab = .compose
                    } label: {
                        Label(type.displayName, systemImage: type.icon)
                    }
                }
            }
            #endif

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

enum IndiePostType: String, CaseIterable {
    case note
    case article
    case photo
    case bookmark
    case reply
    case repost
    case like
    case video

    var displayName: String {
        switch self {
        case .note: return "Note"
        case .article: return "Article"
        case .photo: return "Photo"
        case .bookmark: return "Bookmark"
        case .reply: return "Reply"
        case .repost: return "Repost"
        case .like: return "Like"
        case .video: return "Video"
        }
    }

    var icon: String {
        switch self {
        case .note: return "note.text"
        case .article: return "doc.text"
        case .photo: return "photo"
        case .bookmark: return "bookmark"
        case .reply: return "arrowshape.turn.up.left"
        case .repost: return "arrow.2.squarepath"
        case .like: return "heart"
        case .video: return "play.rectangle"
        }
    }
}

struct ComposeTabView: View {
    @Binding var selectedPostType: IndiePostType
    @State private var showingDrafts = false
    @State private var selectedDraft: String?
    @State private var titleText = ""
    @State private var bodyText = ""

    var body: some View {
        NavigationStack {
            ComposeContentView(
                postType: selectedPostType,
                titleText: $titleText,
                bodyText: $bodyText
            )
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        showingDrafts = true
                    } label: {
                        Image(systemName: "tray")
                    }
                }

                ToolbarItem(placement: .principal) {
                    Menu {
                        ForEach(IndiePostType.allCases, id: \.self) { type in
                            Button {
                                selectedPostType = type
                            } label: {
                                Label(type.displayName, systemImage: type.icon)
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(selectedPostType.displayName)
                                .font(.headline)
                            Image(systemName: "chevron.down")
                                .font(.caption)
                        }
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        // Publish action
                    } label: {
                        Image(systemName: "paperplane")
                    }
                }
            }
            .onChange(of: selectedDraft) { _, newDraft in
                if let draft = newDraft {
                    // Load the draft content
                    titleText = ""
                    bodyText = "Content of \(draft)"
                    selectedDraft = nil
                }
            }
        }
        .sheet(isPresented: $showingDrafts) {
            NavigationStack {
                DraftsListView(selectedDraft: $selectedDraft)
                    .toolbar {
                        ToolbarItem(placement: .navigationBarTrailing) {
                            Button("Done") {
                                showingDrafts = false
                            }
                        }
                    }
            }
        }
    }
}

struct ComposeContentView: View {
    let postType: IndiePostType
    @Binding var titleText: String
    @Binding var bodyText: String
    @State private var urlText = ""
    @FocusState private var isTextEditorFocused: Bool

    var body: some View {
            ScrollView {
                VStack(spacing: 20) {
                    // Main content area based on post type
                    switch postType {
                    case .note:
                        TextEditor(text: $bodyText)
                            .textEditorStyle(.plain)
                            .scrollContentBackground(.hidden)
                            .focused($isTextEditorFocused)
                            .onAppear {
                                isTextEditorFocused = true
                            }
                            .overlay(alignment: .topLeading) {
                                if bodyText.isEmpty {
                                    Text("Start writing...")
                                        .foregroundStyle(.tertiary)
                                        .padding(.horizontal, 5)
                                        .padding(.vertical, 8)
                                        .allowsHitTesting(false)
                                }
                            }

                    case .article:
                        VStack(alignment: .leading, spacing: 8) {
                            TextField("Title", text: $titleText, axis: .vertical)
                                .textFieldStyle(.plain)
                                .font(.title2.weight(.semibold))

                            TextEditor(text: $bodyText)
                                .textEditorStyle(.plain)
                                .scrollContentBackground(.hidden)
                                .focused($isTextEditorFocused)
                                .overlay(alignment: .topLeading) {
                                    if bodyText.isEmpty {
                                        Text("Start writing...")
                                            .foregroundStyle(.tertiary)
                                            .padding(.horizontal, 5)
                                            .padding(.vertical, 8)
                                            .allowsHitTesting(false)
                                    }
                                }
                        }

                    case .photo, .video:
                        VStack(alignment: .leading, spacing: 16) {
                            Button {
                                // Show media picker
                            } label: {
                                VStack(spacing: 12) {
                                    Image(systemName: postType == .photo ? "photo" : "video")
                                        .font(.largeTitle)
                                        .foregroundStyle(.secondary)
                                    Text("Tap to add \(postType.displayName.lowercased())")
                                        .foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity)
                                .frame(height: 200)
                                .background(Color(uiColor: .systemGray6), in: RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)

                            TextEditor(text: $bodyText)
                                .textEditorStyle(.plain)
                                .scrollContentBackground(.hidden)
                                .focused($isTextEditorFocused)
                                .overlay(alignment: .topLeading) {
                                    if bodyText.isEmpty {
                                        Text("Add a caption...")
                                            .foregroundStyle(.tertiary)
                                            .padding(.horizontal, 5)
                                            .padding(.vertical, 8)
                                            .allowsHitTesting(false)
                                    }
                                }
                        }

                    case .bookmark, .reply, .repost, .like:
                        VStack(alignment: .leading, spacing: 8) {
                            TextField(getURLPlaceholder(for: postType), text: $urlText, axis: .vertical)
                                .textFieldStyle(.plain)
                                .foregroundStyle(.link)

                            if postType == .bookmark {
                                TextField("Title (optional)", text: $titleText, axis: .vertical)
                                    .textFieldStyle(.plain)
                                    .font(.headline)
                            }

                            TextEditor(text: $bodyText)
                                .textEditorStyle(.plain)
                                .scrollContentBackground(.hidden)
                                .focused($isTextEditorFocused)
                                .overlay(alignment: .topLeading) {
                                    if bodyText.isEmpty {
                                        Text(getBodyPlaceholder(for: postType))
                                            .foregroundStyle(.tertiary)
                                            .padding(.horizontal, 5)
                                            .padding(.vertical, 8)
                                            .allowsHitTesting(false)
                                    }
                                }
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.top)
            }
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Button(action: {}) {
                        Image(systemName: "wand.and.stars")
                    }

                    Button(action: {}) {
                        Image(systemName: "photo.on.rectangle")
                    }

                    Button(action: {}) {
                        Image(systemName: "camera")
                    }

                    Button(action: {}) {
                        Image(systemName: "waveform")
                    }

                    Button(action: {}) {
                        Image(systemName: "location")
                    }

                    Button(action: {}) {
                        Image(systemName: "figure.walk")
                    }

                    Spacer()

                    Button {
                        isTextEditorFocused = false
                    } label: {
                        Image(systemName: "keyboard.chevron.compact.down")
                    }
                }
            }
        }

    private func getURLPlaceholder(for type: IndiePostType) -> String {
        switch type {
        case .bookmark: return "URL"
        case .reply: return "Reply to URL"
        case .repost: return "URL to repost"
        case .like: return "URL to like"
        default: return "URL"
        }
    }

    private func getBodyPlaceholder(for type: IndiePostType) -> String {
        switch type {
        case .bookmark: return "Notes (optional)"
        case .reply: return "Write your reply..."
        case .repost: return "Add your thoughts..."
        case .like: return "Why do you like this?"
        default: return "Start writing..."
        }
    }

    private func getHintForPostType(_ type: IndiePostType) -> String {
        switch type {
        case .note:
            return "Share a quick thought or update"
        case .article:
            return "Write a longer form piece with title and content"
        case .photo:
            return "Share photos with optional captions"
        case .bookmark:
            return "Save a link for later"
        case .reply:
            return "Reply to someone's post"
        case .repost:
            return "Share someone else's content"
        case .like:
            return "Like something on the web"
        case .video:
            return "Share video content"
        }
    }
}

struct DraftsListView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var drafts: [String] = ["Draft 1", "Draft 2", "Draft 3"] // Mock data for demonstration
    @Binding var selectedDraft: String?

    var body: some View {
        List {
            ForEach(drafts, id: \.self) { draft in
                Button {
                    selectedDraft = draft
                    dismiss()
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(draft)
                                .font(.headline)
                                .foregroundStyle(.primary)
                            Text("Last edited 2 hours ago")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 4)
                }
            }
            .onDelete(perform: deleteDrafts)
        }
        .navigationTitle("Drafts")
        .navigationBarTitleDisplayMode(.large)
    }

    private func deleteDrafts(at offsets: IndexSet) {
        drafts.remove(atOffsets: offsets)
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
