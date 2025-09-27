//
//  MediaGridView.swift
//  Otso
//
//  Grid view for attached media
//

import SwiftUI

struct MediaGridView: View {
    @Binding var images: [PlatformImage]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(images.indices, id: \.self) { index in
                    MediaThumbnail(
                        image: images[index],
                        onRemove: { removeImage(at: index) }
                    )
                }
            }
        }
    }

    private func removeImage(at index: Int) {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            images.remove(at: index)
        }
    }
}

private struct MediaThumbnail: View {
    let image: PlatformImage
    let onRemove: () -> Void

    private var platformImage: some View {
        #if os(iOS)
        Image(uiImage: image)
            .resizable()
            .aspectRatio(contentMode: .fill)
        #elseif os(macOS)
        Image(nsImage: image)
            .resizable()
            .aspectRatio(contentMode: .fill)
        #endif
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            platformImage
                .frame(width: 100, height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.secondary.opacity(0.2), lineWidth: 0.5)
                )

            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title3)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.6))
            }
            .offset(x: 6, y: -6)
        }
    }
}

#Preview {
    MediaGridView(images: .constant([]))
        .padding()
}