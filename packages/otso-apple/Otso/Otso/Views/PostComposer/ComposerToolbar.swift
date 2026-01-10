//
//  ComposerToolbar.swift
//  Otso
//
//  Toolbar for composer actions
//

import SwiftUI

struct ComposerToolbar: View {
    let onPhotoTap: () -> Void
    let onHashtagTap: () -> Void
    let onMentionTap: () -> Void
    let onLinkTap: () -> Void

    var body: some View {
        HStack(spacing: 20) {
            ToolbarButton(icon: "photo", action: onPhotoTap)
            ToolbarButton(icon: "number", action: onHashtagTap)
            ToolbarButton(icon: "at", action: onMentionTap)
            ToolbarButton(icon: "link", action: onLinkTap)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 0.5)
        )
    }
}

private struct ToolbarButton: View {
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(.primary)
                .frame(width: 32, height: 32)
        }
    }
}

#Preview {
    ComposerToolbar(
        onPhotoTap: {},
        onHashtagTap: {},
        onMentionTap: {},
        onLinkTap: {}
    )
    .padding()
}