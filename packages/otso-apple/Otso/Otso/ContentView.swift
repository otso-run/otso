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

// Post model
struct Post: Identifiable {
    let id = UUID()
    let content: String
    let title: String?
    let url: String?
    let tags: [String]
    let type: PostType
    let timestamp: Date
    var likes: Int = 0
    var replies: Int = 0

    var timeAgo: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: timestamp, relativeTo: Date())
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
    @State private var posts: [Post] = []
    @State private var editingPost: Post? = nil
    @Environment(\.isSearching) private var isSearching

    enum ContentFilter {
        case posts
        case mentions
    }

    // Computed property for filtered posts
    var filteredPosts: [Post] {
        if searchText.isEmpty {
            return posts
        }

        let lowercasedSearch = searchText.lowercased()
        return posts.filter { post in
            // Search in content
            post.content.lowercased().contains(lowercasedSearch) ||
            // Search in title if it exists
            (post.title?.lowercased().contains(lowercasedSearch) ?? false) ||
            // Search in tags
            post.tags.contains { tag in
                tag.lowercased().contains(lowercasedSearch)
            } ||
            // Search in URL if it exists
            (post.url?.lowercased().contains(lowercasedSearch) ?? false) ||
            // Search by post type
            post.type.displayName.lowercased().contains(lowercasedSearch)
        }
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
                    PostsListView(posts: isSearching || !searchText.isEmpty ? filteredPosts : posts, editingPost: $editingPost, showingDraft: $showingDraft)
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
                        } else if contentFilter == .posts {
                            // Show actual search results for posts
                            ScrollView {
                                LazyVStack(spacing: 0) {
                                    if filteredPosts.isEmpty {
                                        PlaceholderView(
                                            title: "No posts found",
                                            subtitle: "No posts match \"\(searchText)\"",
                                            icon: "magnifyingglass"
                                        )
                                        .padding(.top, 40)
                                    } else {
                                        // Search results header
                                        HStack {
                                            Text("\(filteredPosts.count) result\(filteredPosts.count == 1 ? "" : "s")")
                                                .font(.headline)
                                            Spacer()
                                        }
                                        .padding()
                                        .background(Color(.systemBackground))

                                        ForEach(filteredPosts) { post in
                                            Button {
                                                editingPost = post
                                                showingDraft = true
                                            } label: {
                                                PostRowView(post: post)
                                            }
                                            .buttonStyle(.plain)
                                            Divider()
                                        }
                                    }
                                }
                            }
                        } else {
                            // Mentions placeholder
                            PlaceholderView(
                                title: "Searching mentions for \"\(searchText)\"",
                                subtitle: "Mentions search coming soon",
                                icon: "at"
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
                draftContent: $draftContent,
                posts: $posts,
                editingPost: $editingPost
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
    @Binding var posts: [Post]
    @Binding var editingPost: Post?

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
                    .padding(.bottom, 100) // Space for floating toolbar
                }

                // Floating liquid glass toolbar
                VStack(spacing: 8) {
                    // Character counter
                    if postContent.count > 0 && postType == .note {
                        HStack {
                            Spacer()
                            Text("\(characterCount) / \(characterLimit)")
                                .font(.caption)
                                .foregroundStyle(characterCount > characterLimit ? .red : .secondary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 4)
                                .background(.thinMaterial)
                                .clipShape(Capsule())
                                .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
                        }
                        .padding(.horizontal, 20)
                    }

                    // Toolbar with liquid glass effect
                    HStack(spacing: 0) {
                        // Quick text actions
                        HStack(spacing: 20) {
                            Button {
                                postContent += "#"
                                focusedField = .content
                            } label: {
                                Image(systemName: "number")
                                    .font(.system(size: 20, weight: .medium))
                                    .symbolRenderingMode(.hierarchical)
                                    .foregroundStyle(.primary)
                                    .frame(width: 36, height: 36)
                                    .background(Circle().fill(.ultraThinMaterial))
                            }
                            .buttonStyle(.plain)

                            Button {
                                postContent += "@"
                                focusedField = .content
                            } label: {
                                Image(systemName: "at")
                                    .font(.system(size: 20, weight: .medium))
                                    .symbolRenderingMode(.hierarchical)
                                    .foregroundStyle(.primary)
                                    .frame(width: 36, height: 36)
                                    .background(Circle().fill(.ultraThinMaterial))
                            }
                            .buttonStyle(.plain)

                            Button {
                                // Add link
                            } label: {
                                Image(systemName: "link")
                                    .font(.system(size: 20, weight: .medium))
                                    .symbolRenderingMode(.hierarchical)
                                    .foregroundStyle(.primary)
                                    .frame(width: 36, height: 36)
                                    .background(Circle().fill(.ultraThinMaterial))
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.leading, 20)

                        Spacer()

                        // Media and format actions
                        HStack(spacing: 20) {
                            Button {
                                // Add photo
                            } label: {
                                Image(systemName: "photo")
                                    .font(.system(size: 20, weight: .medium))
                                    .symbolRenderingMode(.hierarchical)
                                    .foregroundStyle(.primary)
                                    .frame(width: 36, height: 36)
                                    .background(Circle().fill(.ultraThinMaterial))
                            }
                            .buttonStyle(.plain)

                            Button {
                                // Camera
                            } label: {
                                Image(systemName: "camera")
                                    .font(.system(size: 20, weight: .medium))
                                    .symbolRenderingMode(.hierarchical)
                                    .foregroundStyle(.primary)
                                    .frame(width: 36, height: 36)
                                    .background(Circle().fill(.ultraThinMaterial))
                            }
                            .buttonStyle(.plain)

                            Rectangle()
                                .fill(Color(.separator).opacity(0.3))
                                .frame(width: 1, height: 24)
                                .padding(.horizontal, 8)

                            Button {
                                // Format text
                            } label: {
                                Image(systemName: "textformat")
                                    .font(.system(size: 20, weight: .medium))
                                    .symbolRenderingMode(.hierarchical)
                                    .foregroundStyle(.primary)
                                    .frame(width: 36, height: 36)
                                    .background(Circle().fill(.ultraThinMaterial))
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.trailing, 20)
                    }
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 28)
                            .fill(.regularMaterial)
                            .shadow(color: .black.opacity(0.15), radius: 12, x: 0, y: 4)
                    )
                    .padding(.horizontal, 16)
                }
                .padding(.bottom, 16) // Margin above keyboard
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
                            if let editing = editingPost {
                                // Update existing post
                                if let index = posts.firstIndex(where: { $0.id == editing.id }) {
                                    posts[index] = Post(
                                        content: postContent,
                                        title: postTitle.isEmpty ? nil : postTitle,
                                        url: postURL.isEmpty ? nil : postURL,
                                        tags: postTags.isEmpty ? [] : postTags.split(separator: " ").map { String($0).trimmingCharacters(in: .whitespaces) },
                                        type: postType,
                                        timestamp: editing.timestamp,
                                        likes: editing.likes,
                                        replies: editing.replies
                                    )
                                }
                            } else {
                                // Create new post
                                let newPost = Post(
                                    content: postContent,
                                    title: postTitle.isEmpty ? nil : postTitle,
                                    url: postURL.isEmpty ? nil : postURL,
                                    tags: postTags.isEmpty ? [] : postTags.split(separator: " ").map { String($0).trimmingCharacters(in: .whitespaces) },
                                    type: postType,
                                    timestamp: Date(),
                                    likes: 0,
                                    replies: 0
                                )

                                // Add to posts array at the beginning
                                posts.insert(newPost, at: 0)
                            }

                            // Clear form and dismiss
                            editingPost = nil
                            showingDraft = false
                            hasDraft = false
                            draftContent = ""
                            postContent = ""
                            postTitle = ""
                            postURL = ""
                            postTags = ""
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
            // Load editing post data if editing
            if let editing = editingPost {
                postContent = editing.content
                postTitle = editing.title ?? ""
                postURL = editing.url ?? ""
                postTags = editing.tags.joined(separator: " ")
                postType = editing.type
            } else if !draftContent.isEmpty {
                // Restore draft content if not editing
                postContent = draftContent
            }

            // Focus appropriate field based on post type
            if [.bookmark, .like, .reply, .repost].contains(postType) {
                focusedField = .url
            } else if postType == .article {
                focusedField = .title
            } else {
                focusedField = .content
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
    let posts: [Post]
    @Binding var editingPost: Post?
    @Binding var showingDraft: Bool
    @State private var hideNavBar = false
    @State private var lastScrollOffset: CGFloat = 0

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

                if posts.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "square.and.pencil")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        Text("No posts yet")
                            .font(.title3)
                            .fontWeight(.medium)
                        Text("Tap the compose button below to create your first post")
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(40)
                    .frame(maxWidth: .infinity, minHeight: 400)
                } else {
                    ForEach(posts) { post in
                        Button {
                            editingPost = post
                            showingDraft = true
                        } label: {
                            PostRowView(
                                post: post
                            )
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
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
    let post: Post

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Show post type badge if not a note
            if post.type != .note {
                HStack {
                    Image(systemName: post.type.icon)
                        .font(.caption)
                    Text(post.type.displayName)
                        .font(.caption)
                        .fontWeight(.medium)
                }
                .foregroundStyle(.secondary)
            }

            // Show title if present (for articles)
            if let title = post.title, !title.isEmpty {
                Text(title)
                    .font(.headline)
                    .multilineTextAlignment(.leading)
            }

            // Show URL if present
            if let url = post.url, !url.isEmpty {
                Text(url)
                    .font(.caption)
                    .foregroundStyle(.blue)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            // Main content
            Text(post.content)
                .font(.body)
                .multilineTextAlignment(.leading)

            // Show tags if present
            if !post.tags.isEmpty {
                HStack {
                    ForEach(post.tags, id: \.self) { tag in
                        Text(tag)
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color(.systemGray6))
                            .clipShape(Capsule())
                    }
                }
            }

            // Metadata
            HStack(spacing: 20) {
                Label(post.timeAgo, systemImage: "clock")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Label("\(post.likes)", systemImage: "heart")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Label("\(post.replies)", systemImage: "bubble.left")
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
