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
#else
import UIKit
#endif

// Preference key for tracking scroll offset
struct ScrollOffsetPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

struct ContentView: View {
    @State private var showingSettings = false
    @State private var searchText = ""
    @State private var selectedTab = "posts"  // Default to posts tab
    @State private var contentFilter: ContentFilter = .posts
    @State private var draftCompactHeight: Double? = nil
    @State private var draftSelectedDetent: PresentationDetent = .height(1)
    @State private var hasDraft = false
    @State private var showingDraft = false
    @State private var draftContent = ""
    @Environment(\.isSearching) private var isSearching

    enum ContentFilter {
        case posts
        case mentions
    }

    private var detents: Set<PresentationDetent> {
        [.large, .height(1)]
    }

    private var backgroundInteraction: PresentationBackgroundInteraction {
        .enabled(upThrough: .height(1))
    }

    @ViewBuilder
    private var tabAccessoryButton: some View {
        Button {
            if showingDraft {
                // Expand the draft if minimized
                draftSelectedDetent = .large
            } else {
                // Create new draft
                draftSelectedDetent = .large
                showingDraft = true
                hasDraft = true
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: hasDraft ? "square.and.pencil" : "square.and.pencil")
                    .font(.system(size: 20))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.primary)

                Text(hasDraft && !draftContent.isEmpty ? draftContent : "New post")
                    .font(.callout)
                    .fontWeight(hasDraft ? .medium : .regular)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Spacer()

                if hasDraft && draftSelectedDetent != .large {
                    // Show a minimize indicator when draft is minimized
                    Circle()
                        .fill(Color(.systemGray3))
                        .frame(width: 8, height: 8)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            // Posts tab
            Tab("Posts", systemImage: "text.badge.checkmark", value: "posts") {
                NavigationStack {
                    PostsListView()
                        .navigationTitle("Posts")
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button {
                                    showingSettings = true
                                } label: {
                                    Image(systemName: "person.crop.circle")
                                        .font(.title3)
                                }
                            }
                        }
                        .sheet(isPresented: $showingSettings) {
                            NavigationStack {
                                SettingsView()
                                    .navigationTitle("Settings")
                                    .navigationBarTitleDisplayMode(.inline)
                                    .toolbar {
                                        ToolbarItem(placement: .topBarTrailing) {
                                            Button("Done") {
                                                showingSettings = false
                                            }
                                        }
                                    }
                            }
                        }
                }
            }

            // Mentions tab
            Tab("Mentions", systemImage: "at", value: "mentions") {
                NavigationStack {
                    PlaceholderView(
                        title: "Mentions",
                        subtitle: "See where you've been mentioned",
                        icon: "at"
                    )
                    .navigationTitle("Mentions")
                }
            }

            // Search tab with special role
            Tab(value: "search", role: .search) {
                NavigationStack {
                    VStack(spacing: 0) {
                        // Segmented control for switching between Posts and Mentions
                        Picker("Content Filter", selection: $contentFilter) {
                            Text("Posts").tag(ContentFilter.posts)
                            Text("Mentions").tag(ContentFilter.mentions)
                        }
                        .pickerStyle(.segmented)
                        .padding()

                        // Search results based on selected filter
                        if searchText.isEmpty {
                            PlaceholderView(
                                title: "Search \(contentFilter == .posts ? "Posts" : "Mentions")",
                                subtitle: "Find \(contentFilter == .posts ? "posts by title, content, or tags" : "mentions across the web")",
                                icon: "magnifyingglass"
                            )
                        } else {
                            PlaceholderView(
                                title: "Searching \(contentFilter == .posts ? "posts" : "mentions") for \"\(searchText)\"",
                                subtitle: "No results found",
                                icon: "magnifyingglass"
                            )
                        }
                    }
                    .navigationTitle("Search")
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search")
        .tabViewBottomAccessory {
            tabAccessoryButton
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .sheet(isPresented: $showingDraft) {
            DraftComposerView(
                compactHeight: $draftCompactHeight,
                selectedDetent: $draftSelectedDetent,
                hasDraft: $hasDraft,
                showingDraft: $showingDraft,
                draftContent: $draftContent
            )
            .interactiveDismissDisabled(draftSelectedDetent != .large)
            .presentationDetents(detents, selection: $draftSelectedDetent)
            .presentationBackgroundInteraction(backgroundInteraction)
            .presentationDragIndicator(.visible)
        }
        .onChange(of: showingDraft) { _, newValue in
            if newValue {
                draftSelectedDetent = .large
            }
        }
        .onChange(of: draftSelectedDetent) { _, newDetent in
            // When minimized to small height, hide the sheet
            if newDetent == .height(1) && showingDraft {
                showingDraft = false
            }
        }
    }
}

struct DraftComposerView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var compactHeight: Double?
    @Binding var selectedDetent: PresentationDetent
    @Binding var hasDraft: Bool
    @Binding var showingDraft: Bool
    @Binding var draftContent: String

    @State private var postContent = ""
    @State private var postType: PostType = .note
    @State private var postTitle = ""
    @State private var postURL = ""
    @State private var postTags = ""
    @State private var postLocation = ""
    @FocusState private var isTextEditorFocused: Bool
    @FocusState private var focusedField: Field?
    @State private var previousDetent: PresentationDetent = .large

    enum Field: Hashable {
        case title, url, content, tags, location
    }

    private var characterCount: Int {
        postContent.count
    }

    private var characterLimit: Int {
        postType == .note ? 280 : 10000
    }

    private func getURLPlaceholder() -> String {
        switch postType {
        case .reply: return "URL to reply to"
        case .repost: return "URL to repost"
        case .like: return "URL to like"
        case .bookmark: return "URL to bookmark"
        default: return "https://example.com/post"
        }
    }

    private func getPlaceholderText() -> String {
        switch postType {
        case .note: return "What's on your mind?"
        case .article: return "Write your article..."
        case .photo: return "Describe your photo..."
        case .reply: return "Write your reply..."
        case .repost: return "Add a comment..."
        case .bookmark: return "Add notes about this bookmark..."
        default: return "Write something..."
        }
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                // Main content
                ScrollView {
                    VStack(spacing: 12) {
                        // URL field for bookmark, like, reply, repost
                        if [.bookmark, .like, .reply, .repost].contains(postType) {
                            TextField(getURLPlaceholder(), text: $postURL)
                                .textFieldStyle(.plain)
                                .font(.system(size: 17))
                                .padding(.horizontal, 20)
                                .padding(.vertical, 14)
                                .background(Color(.systemGray6))
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .padding(.horizontal, 20)
                                .focused($focusedField, equals: .url)
                        }

                        // Title field for articles
                        if postType == .article {
                            TextField("Article title", text: $postTitle)
                                .textFieldStyle(.plain)
                                .font(.system(size: 17, weight: .semibold))
                                .padding(.horizontal, 20)
                                .padding(.vertical, 14)
                                .background(Color(.systemGray6))
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .padding(.horizontal, 20)
                                .focused($focusedField, equals: .title)
                        }

                        // Main content field (except for like)
                        if postType != .like {
                            ZStack(alignment: .topLeading) {
                                TextEditor(text: $postContent)
                                    .focused($focusedField, equals: .content)
                                    .onChange(of: postContent) { _, newValue in
                                        draftContent = newValue
                                    }
                                    .font(.system(size: 17))
                                    .scrollContentBackground(.hidden)
                                    .padding(12)
                                    .frame(minHeight: postType == .article ? 200 : 120)
                                    .background(Color(.systemGray6))
                                    .clipShape(RoundedRectangle(cornerRadius: 12))

                                if postContent.isEmpty {
                                    Text(getPlaceholderText())
                                        .font(.system(size: 17))
                                        .foregroundColor(.secondary.opacity(0.5))
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 16)
                                        .allowsHitTesting(false)
                                }
                            }
                            .padding(.horizontal, 20)
                        }

                        // Tags field
                        if [.note, .article, .photo].contains(postType) {
                            TextField("Add tags #indieweb #webmention", text: $postTags)
                                .textFieldStyle(.plain)
                                .font(.system(size: 17))
                                .padding(.horizontal, 20)
                                .padding(.vertical, 14)
                                .background(Color(.systemGray6))
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .padding(.horizontal, 20)
                                .focused($focusedField, equals: .tags)
                        }
                    }
                    .padding(.top, 20)
                    .padding(.bottom, 100) // Space for toolbar
                }

                // Floating toolbar at bottom
                VStack(spacing: 0) {
                    // Character counter
                    if postContent.count > 0 {
                        HStack {
                            Spacer()
                            Text("\(characterCount)")
                                .font(.caption)
                                .foregroundStyle(characterCount > characterLimit ? .red : .secondary)
                                .padding(.trailing, 20)
                                .padding(.bottom, 8)
                        }
                    }

                    // Toolbar
                    HStack(spacing: 20) {
                        Button {
                            // Add photo
                        } label: {
                            Image(systemName: "photo")
                                .font(.system(size: 20))
                                .foregroundStyle(.primary)
                        }

                        Button {
                            // Add hashtag
                            postContent += "#"
                            isTextEditorFocused = true
                        } label: {
                            Image(systemName: "number")
                                .font(.system(size: 20))
                                .foregroundStyle(.primary)
                        }

                        Button {
                            // Add mention
                            postContent += "@"
                            isTextEditorFocused = true
                        } label: {
                            Image(systemName: "at")
                                .font(.system(size: 20))
                                .foregroundStyle(.primary)
                        }

                        Button {
                            // Add link
                        } label: {
                            Image(systemName: "link")
                                .font(.system(size: 20))
                                .foregroundStyle(.primary)
                        }

                        Spacer()

                        Button {
                            // Format text
                        } label: {
                            Image(systemName: "textformat")
                                .font(.system(size: 20))
                                .foregroundStyle(.primary)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(.regularMaterial)
                }
            }
                .navigationTitle("")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            showingDraft = false
                            hasDraft = false
                            draftContent = ""
                            postContent = ""
                        } label: {
                            Image(systemName: "xmark")
                                .font(.body)
                                .fontWeight(.medium)
                                .foregroundStyle(.primary)
                        }
                    }

                    ToolbarItem(placement: .principal) {
                        Menu {
                            Button {
                                postType = .note
                            } label: {
                                Label("Note", systemImage: "note.text")
                            }
                            Button {
                                postType = .article
                            } label: {
                                Label("Article", systemImage: "doc.text")
                            }
                            Button {
                                postType = .photo
                            } label: {
                                Label("Photo", systemImage: "photo")
                            }
                            Button {
                                postType = .reply
                            } label: {
                                Label("Reply", systemImage: "arrowshape.turn.up.left")
                            }
                            Button {
                                postType = .repost
                            } label: {
                                Label("Repost", systemImage: "arrow.2.squarepath")
                            }
                            Button {
                                postType = .like
                            } label: {
                                Label("Like", systemImage: "heart")
                            }
                            Button {
                                postType = .bookmark
                            } label: {
                                Label("Bookmark", systemImage: "bookmark")
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Text("New \(postType.displayName.lowercased())")
                                    .font(.headline)
                                Image(systemName: "chevron.down")
                                    .font(.caption)
                            }
                            .foregroundStyle(.primary)
                        }
                    }

                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            // Post action
                            showingDraft = false
                            hasDraft = false
                            draftContent = ""
                            postContent = ""
                        } label: {
                            Image(systemName: "arrow.up")
                                .font(.title2)
                                .fontWeight(.semibold)
                                .foregroundStyle(postContent.isEmpty || characterCount > characterLimit ? Color.secondary : Color.accentColor)
                        }
                        .disabled(postContent.isEmpty || characterCount > characterLimit)
                    }
            }
            .toolbarBackground(.visible, for: .navigationBar)
        }
        .onAppear {
            // Focus appropriate field based on post type
            if [.bookmark, .like, .reply, .repost].contains(postType) {
                focusedField = .url
            } else if postType == .article {
                focusedField = .title
            } else {
                focusedField = .content
            }

            // Restore draft content
            if !draftContent.isEmpty {
                postContent = draftContent
            }
        }
        .onChange(of: selectedDetent) { oldValue, newValue in
            // Dismiss keyboard immediately when detent changes
            focusedField = nil
            previousDetent = oldValue
        }
        .onChange(of: postType) { _, newType in
            // Focus appropriate field when post type changes
            if [.bookmark, .like, .reply, .repost].contains(newType) {
                focusedField = .url
            } else if newType == .article {
                focusedField = .title
            } else {
                focusedField = .content
            }
        }
        .presentationDragIndicator(.visible)
    }
}

struct PostsListView: View {
    @State private var hideNavBar = false
    @State private var lastScrollOffset: CGFloat = 0

    let samplePosts = [
        ("Just shipped a major update to my app! 🚀", "2 hours ago", 42, 8),
        ("Working on some exciting new features. Stay tuned for the announcement next week!", "5 hours ago", 128, 24),
        ("The new SwiftUI APIs in iOS 18 are incredible. Been experimenting with the new tab bar accessories.", "1 day ago", 256, 45),
        ("Coffee ☕ + Code 💻 = Perfect morning", "2 days ago", 89, 12),
        ("Just discovered an amazing design pattern that simplified my entire architecture. Blog post coming soon!", "3 days ago", 367, 78),
        ("Weekend project: Building a custom camera interface with AVFoundation", "4 days ago", 198, 34),
        ("TIL: You can use @State with computed properties in SwiftUI. Mind blown 🤯", "5 days ago", 445, 92),
        ("The attention to detail in iOS 18's liquid glass design is remarkable", "1 week ago", 234, 41),
        ("Debugging is like being the detective in a crime movie where you are also the murderer", "1 week ago", 892, 156),
        ("Finally got dark mode working perfectly across all screens!", "2 weeks ago", 145, 28),
        ("Pro tip: Use Instruments early and often. Your users will thank you.", "2 weeks ago", 267, 52),
        ("The SwiftUI preview canvas is a game changer for rapid prototyping", "3 weeks ago", 189, 31),
        ("Just crossed 10K downloads on the App Store! Thank you everyone! 🎉", "1 month ago", 1234, 234),
        ("Working remotely from a coffee shop today. The ambiance is perfect for coding.", "1 month ago", 78, 15),
        ("Remember to take breaks and stretch. Your body will thank you.", "1 month ago", 156, 22)
    ]

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                // Invisible geometry reader for scroll detection
                GeometryReader { geometry in
                    Color.clear
                        .preference(key: ScrollOffsetPreferenceKey.self,
                                  value: geometry.frame(in: .named("scroll")).minY)
                }
                .frame(height: 0)

                ForEach(Array(samplePosts.enumerated()), id: \.offset) { _, post in
                    PostRowView(
                        content: post.0,
                        timeAgo: post.1,
                        likes: post.2,
                        replies: post.3
                    )
                    Divider()
                }
            }
        }
        .coordinateSpace(name: "scroll")
        .onPreferenceChange(ScrollOffsetPreferenceKey.self) { offset in
            let scrollDelta = offset - lastScrollOffset

            withAnimation(.easeInOut(duration: 0.25)) {
                if scrollDelta < -2 && offset < -10 {
                    // Scrolling down - hide nav bar
                    hideNavBar = true
                } else if scrollDelta > 2 {
                    // Scrolling up - show nav bar
                    hideNavBar = false
                }
            }
            lastScrollOffset = offset
        }
        .toolbar(hideNavBar ? .hidden : .visible, for: .navigationBar)
    }
}

struct PostRowView: View {
    let content: String
    let timeAgo: String
    let likes: Int
    let replies: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(content)
                .font(.body)
                .multilineTextAlignment(.leading)

            HStack(spacing: 20) {
                Label(timeAgo, systemImage: "clock")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Label("\(likes)", systemImage: "heart")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Label("\(replies)", systemImage: "bubble.left")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()
            }
        }
        .padding()
        .contentShape(Rectangle())
        .hoverEffect()
    }
}

struct SettingsView: View {
    var body: some View {
        PlaceholderView(
            title: "Settings",
            subtitle: "Manage accounts and preferences",
            icon: "gearshape"
        )
        .navigationTitle("Settings")
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
