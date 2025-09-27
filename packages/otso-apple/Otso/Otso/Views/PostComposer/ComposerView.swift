//
//  ComposerView.swift
//  Otso
//
//  Main post composer interface
//

import SwiftUI
import PhotosUI
#if os(iOS)
import UIKit
#endif

struct ComposerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var postContent = ""
    @State private var postType: PostType = .note
    @State private var visibility: Visibility = .public
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var attachedImages: [PlatformImage] = []
    @State private var showingPhotoPicker = false
    @State private var isSavingDraft = false
    @State private var isPublishing = false
    @FocusState private var isTextEditorFocused: Bool

    private var characterCount: Int {
        postContent.count
    }

    private var characterLimit: Int {
        postType == .note ? 280 : 10000
    }

    private var canPublish: Bool {
        !postContent.isEmpty && characterCount <= characterLimit
    }

    private var backgroundView: some View {
        #if os(iOS)
        Color(.systemBackground)
        #else
        Color(NSColor.windowBackgroundColor)
        #endif
    }

    var body: some View {
        NavigationStack {
            ZStack {
                // Background
                backgroundView
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Post type selector
                        PostTypeSelector(selection: $postType)
                            .padding(.horizontal)

                        // Text editor
                        VStack(alignment: .leading, spacing: 8) {
                            ZStack(alignment: .topLeading) {
                                TextEditor(text: $postContent)
                                    .focused($isTextEditorFocused)
                                    .font(.body)
                                    .scrollContentBackground(.hidden)
                                    .padding(12)
                                    .frame(minHeight: postType == .note ? 120 : 200)
                                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 16)
                                            .stroke(
                                                isTextEditorFocused
                                                    ? Color.accentColor.opacity(0.5)
                                                    : Color.clear,
                                                lineWidth: 1
                                            )
                                    )

                                if postContent.isEmpty {
                                    Text(placeholderText)
                                        .font(.body)
                                        .foregroundColor(.secondary)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 20)
                                        .allowsHitTesting(false)
                                }
                            }

                            // Character counter
                            CharacterCounter(
                                current: characterCount,
                                limit: characterLimit
                            )
                        }
                        .padding(.horizontal)

                        // Attached media
                        if !attachedImages.isEmpty {
                            MediaGridView(images: $attachedImages)
                                .padding(.horizontal)
                        }

                        // Visibility picker
                        VisibilityPicker(selection: $visibility)
                            .padding(.horizontal)
                    }
                    .padding(.vertical)
                }

                // Composer toolbar
                VStack {
                    Spacer()
                    ComposerToolbar(
                        onPhotoTap: { showingPhotoPicker = true },
                        onHashtagTap: { insertText("#") },
                        onMentionTap: { insertText("@") },
                        onLinkTap: { /* Show link dialog */ }
                    )
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                }
            }
            .navigationTitle(postType == .note ? "New Note" : "New \(postType.displayName)")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Menu {
                        Button {
                            saveDraft()
                        } label: {
                            Label("Save Draft", systemImage: "doc.text")
                        }

                        Button {
                            publish()
                        } label: {
                            Label("Publish", systemImage: "paperplane")
                        }
                        .disabled(!canPublish)
                    } label: {
                        if isPublishing || isSavingDraft {
                            ProgressView()
                        } else {
                            Text("Post")
                                .fontWeight(.semibold)
                                .foregroundColor(canPublish ? .accentColor : .gray)
                        }
                    }
                    .disabled(isPublishing || isSavingDraft)
                }
            }
            .photosPicker(
                isPresented: $showingPhotoPicker,
                selection: $selectedPhotos,
                maxSelectionCount: 4,
                matching: .images
            )
            .onChange(of: selectedPhotos) { _, newItems in
                loadSelectedPhotos(newItems)
            }
            .onAppear {
                isTextEditorFocused = true
            }
        }
    }

    private var placeholderText: String {
        switch postType {
        case .note:
            return "What's on your mind?"
        case .article:
            return "Write your article..."
        case .reply:
            return "Write your reply..."
        default:
            return "Compose your post..."
        }
    }

    private func insertText(_ text: String) {
        postContent += text
    }

    private func loadSelectedPhotos(_ items: [PhotosPickerItem]) {
        Task {
            attachedImages = []
            for item in items {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    #if os(iOS)
                    if let image = UIImage(data: data) {
                        await MainActor.run {
                            attachedImages.append(image)
                        }
                    }
                    #elseif os(macOS)
                    if let image = NSImage(data: data) {
                        await MainActor.run {
                            attachedImages.append(image)
                        }
                    }
                    #endif
                }
            }
        }
    }

    private func saveDraft() {
        isSavingDraft = true

        // Mock save
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            isSavingDraft = false
            dismiss()
        }
    }

    private func publish() {
        isPublishing = true

        // Mock publish
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            isPublishing = false
            dismiss()
        }
    }
}

#Preview {
    ComposerView()
}