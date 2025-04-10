// public/extensions/third-party/my-favorites-plugin/index.js

// Import from the core script (public/script.js)
import {
    saveSettingsDebounced,
    getCurrentChatId,
    eventSource,
    event_types,
    // ---- NEW IMPORTS ----
    doNewChat,          // To create a new chat
    clearChat,          // To clear the chat content
    renameChat,         // To rename the new chat
    openCharacterChat,  // To switch to a character chat
    this_chid,          // Needed for openCharacterChat context
    // messageFormatting, // Not strictly needed for basic preview, but could be used
} from '../../../../script.js';

// Import from group chats if group functionality is needed for switching
import {
    openGroupChat,      // To switch to a group chat
    selected_group,     // Needed for openGroupChat context
} from '../../../group-chats.js'; // Adjust path if needed

// Import from the extension helper script (public/scripts/extensions.js)
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
} from '../../../extensions.js';

// Import from the Popup utility script (public/scripts/popup.js)
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// Import from the general utility script (public/scripts/utils.js)
import {
    uuidv4,
    timestampToMoment,
} from '../../../utils.js';

import { t } from '../../../i18n.js';
// jQuery ($) is globally available

(function () { // Use IIFE to encapsulate plugin logic

    const pluginName = 'my-favorites-plugin';
    const pluginFolderName = 'my-favorites-plugin'; // Matches the actual folder name
    const logPrefix = `[${pluginName}]`;
    const previewChatName = '<预览聊天>'; // Name for the preview chat

    // --- Constants ---
    // ... (keep existing constants)
    const favIconClass = 'favorite-toggle-icon';
    const favIconSelector = `.${favIconClass}`;
    const favoritedIconClass = 'fa-solid fa-star'; // Gold, solid star
    const unfavoritedIconClass = 'fa-regular fa-star'; // Hollow star
    const settingsContainerId = 'favorites-plugin-settings-area';
    const sidebarButtonId = 'my_favorites_sidebar_button';
    const popupListContainerId = 'favorites-popup-list-container';
    const popupPaginationId = 'favorites-popup-pagination';
    const pluginPageListContainerId = 'favorites-plugin-page-list';
    const pluginPagePaginationId = 'favorites-plugin-page-pagination';
    const itemsPerPagePopup = 10;
    const itemsPerPagePluginPage = 20;
    const previewButtonId = 'fav-popup-preview'; // ID for the new preview button

    // --- HTML Snippets ---
    // ... (keep existing snippets)
     const messageButtonHtml = `
        <div class="mes_button ${favIconClass}" title="Favorite/Unfavorite Message">
            <i class="${unfavoritedIconClass}"></i>
        </div>
    `;

    // --- Global State ---
    // ... (keep existing state)
    let favoritesPopup = null; // Stores the Popup instance
    let currentPopupChatId = null; // Tracks which chat the popup is showing
    let currentPopupPage = 1;
    let currentPluginPagePage = 1;
    let isPreviewing = false; // Flag to indicate if the preview chat is active

    // --- Core Data Functions ---

    /**
     * Ensures the plugin's settings object and sub-objects exist.
     */
    function initializeSettings() {
        if (!extension_settings[pluginName]) {
            extension_settings[pluginName] = { chats: {}, previews: {} }; // Add 'previews'
            console.log(logPrefix, 'Initialized settings.');
        }
        // Ensure 'chats' sub-object exists
        if (!extension_settings[pluginName].chats) {
            extension_settings[pluginName].chats = {};
        }
        // ---- NEW: Ensure 'previews' sub-object exists ----
        if (!extension_settings[pluginName].previews) {
            extension_settings[pluginName].previews = {};
        }
    }

    /**
     * Gets the plugin's settings object.
     * @returns {object} The plugin settings.
     */
    function getPluginSettings() {
        initializeSettings(); // Ensure it's initialized before accessing
        return extension_settings[pluginName];
    }

    // --- NEW: Preview Chat Association Helpers ---
    /**
     * Gets the preview chat ID associated with an original chat ID.
     * @param {string} originalChatId
     * @returns {string|null} The preview chat ID or null if not found.
     */
    function getPreviewChatId(originalChatId) {
        const settings = getPluginSettings();
        return settings.previews[originalChatId] || null;
    }

    /**
     * Sets the preview chat ID associated with an original chat ID.
     * @param {string} originalChatId
     * @param {string} previewChatId
     */
    function setPreviewChatId(originalChatId, previewChatId) {
        const settings = getPluginSettings();
        settings.previews[originalChatId] = previewChatId;
        saveSettingsDebounced();
        console.log(logPrefix, `Associated original chat ${originalChatId} with preview chat ${previewChatId}`);
    }

    /**
     * Removes the preview chat association for an original chat ID.
     * @param {string} originalChatId
     */
    function removePreviewChatId(originalChatId) {
        const settings = getPluginSettings();
        if (settings.previews[originalChatId]) {
            delete settings.previews[originalChatId];
            saveSettingsDebounced();
            console.log(logPrefix, `Removed preview chat association for original chat ${originalChatId}`);
        }
    }
    // --- End Preview Chat Association Helpers ---


    /**
     * Gets chat info for the current context.
     * @returns {object|null} { chatId, type, name, characterId?, groupId? } or null if context unavailable.
     */
    function getCurrentChatInfo() {
        try {
            const context = getContext();
            const chatId = getCurrentChatId(); // From script.js
            if (!chatId) return null;

            let type, name, characterId, groupId;

            // Use selected_group and this_chid directly for more reliability
            groupId = selected_group; // Might be null
            characterId = this_chid; // Might be undefined

            if (groupId) {
                type = "group";
                const group = context.groups ? context.groups.find(g => g.id === groupId) : null;
                name = group ? group.name : `Group ${groupId}`;
                 // Ensure chatId matches group context if possible
                 if (group && group.chat_id && group.chat_id !== chatId) {
                     console.warn(logPrefix, `Mismatch between getCurrentChatId (${chatId}) and selected group's chat_id (${group.chat_id}). Using getCurrentChatId.`);
                 }
            } else if (characterId !== undefined) { // Check for undefined specifically
                type = "private";
                name = context.name2; // Character name
                 // Ensure chatId matches character context if possible
                 const character = context.characters ? context.characters.find(c => c.id === characterId) : null;
                 if (character && character.chat && character.chat !== chatId) {
                     console.warn(logPrefix, `Mismatch between getCurrentChatId (${chatId}) and selected character's chat (${character.chat}). Using getCurrentChatId.`);
                 }
            } else {
                console.warn(logPrefix, "Could not determine chat type for ID:", chatId);
                return null; // Or handle as a generic chat type if applicable
            }

            return { chatId, type, name, characterId, groupId };
        } catch (error) {
            console.error(logPrefix, "Error getting current chat info:", error);
            return null;
        }
    }


     /**
     * Gets a specific chat message object from the current context's chat array.
     * @param {string|number} messageId The ID of the message to find.
     * @returns {object|null} The message object or null if not found.
     */
     function getChatMessageById(messageId) {
        try {
            const context = getContext();
            // Ensure context.chat exists and is an array
            if (!context || !Array.isArray(context.chat)) {
                 // console.warn(logPrefix, `Context or context.chat is invalid when getting message ${messageId}`);
                return null;
            }
            // Ensure messageId is parsed correctly if it's sometimes a string/number
            // SillyTavern messages often use numeric IDs (indices)
            const targetId = typeof messageId === 'string' ? parseInt(messageId, 10) : messageId;
            // Check if targetId is a valid number after parsing
            if (isNaN(targetId)) {
                 console.warn(logPrefix, `Invalid messageId format: ${messageId}`);
                 return null;
            }
            // Find message by index (which is usually the 'id' in ST messages)
            return context.chat[targetId] || null; // Directly access by index
            // If IDs are not indices, use find:
            // return context.chat.find(msg => msg.id === targetId) || null;
        } catch (error) {
            // console.warn(logPrefix, `Could not get message ${messageId} from context:`, error);
            return null;
        }
    }

    // --- NEW: Get Full Favorite Messages Helper ---
    /**
     * Retrieves the full message objects for all favorited items in a given chat.
     * @param {string} chatId The ID of the original chat containing the favorites.
     * @returns {Promise<object[]>} A promise that resolves to an array of full message objects, sorted by timestamp.
     */
    async function getFullFavoriteMessages(chatId) {
        console.log(logPrefix, `Getting full favorite messages for chat ${chatId}`);
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        const fullMessages = [];

        if (!chatData || !chatData.items || chatData.items.length === 0) {
            console.log(logPrefix, `No favorite items found for chat ${chatId}`);
            return []; // Return empty array if no favorites
        }

        // IMPORTANT: Get the context of the *original* chat.
        // This assumes this function is called *before* switching context.
        const context = getContext();
        if (getCurrentChatId() !== chatId) {
             console.error(logPrefix, `CRITICAL: getFullFavoriteMessages called while context is for chat ${getCurrentChatId()}, but expected ${chatId}. Aborting.`);
             // Ideally, load the original chat context if needed, but that's complex.
             // For this flow, we rely on calling it from the original context.
             toastr.error("Error: Context mismatch while fetching favorite messages.");
             return [];
        }

        const originalChatMessages = context.chat; // Get the current chat array

        if (!Array.isArray(originalChatMessages)) {
             console.error(logPrefix, `Original chat messages for ${chatId} are not available or not an array.`);
             toastr.error("Error: Could not retrieve original chat messages.");
            return [];
        }

        console.log(logPrefix, `Found ${originalChatMessages.length} messages in original chat context.`);

        for (const favItem of chatData.items) {
            // Find the message object using the stored messageId
            // Ensure consistent ID comparison (message IDs in ST are usually numbers/indices)
            const messageIdNum = parseInt(favItem.messageId, 10);
            if (isNaN(messageIdNum)) {
                console.warn(logPrefix, `Skipping favorite with invalid messageId: ${favItem.messageId}`);
                continue;
            }

            // Find message by index in the original chat array
            const fullMessage = originalChatMessages[messageIdNum];

            // Alternative if IDs are not indices:
            // const fullMessage = originalChatMessages.find(msg => String(msg.id) === String(favItem.messageId));

            if (fullMessage) {
                // Create a deep copy to avoid modifying the original context's chat array
                const messageCopy = JSON.parse(JSON.stringify(fullMessage));
                // Optionally add the favorite note to the message object for display in preview?
                // messageCopy.favoriteNote = favItem.note;
                fullMessages.push(messageCopy);
                 // console.log(logPrefix, `Found full message for fav item msgId ${favItem.messageId}`);
            } else {
                console.warn(logPrefix, `Could not find original message for favorite item with messageId ${favItem.messageId} (it might have been deleted). Skipping.`);
            }
        }

        // Sort the collected messages by their original send date (timestamp)
        fullMessages.sort((a, b) => a.send_date - b.send_date);

        console.log(logPrefix, `Collected ${fullMessages.length} full favorite messages.`);
        return fullMessages;
    }
    // --- End Get Full Favorite Messages Helper ---


    /**
     * Checks if a message is currently favorited.
     * @param {string} chatId The chat ID.
     * @param {string|number} messageId The message ID.
     * @returns {boolean} True if favorited, false otherwise.
     */
    function isFavorited(chatId, messageId) {
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        if (!chatData || !chatData.items) return false;
        // Use consistent string comparison
        const stringMessageId = String(messageId);
        return chatData.items.some(item => String(item.messageId) === stringMessageId);
    }

    /**
     * Adds a message to favorites.
     * @param {object} chatInfo - Result from getCurrentChatInfo().
     * @param {object} message - The message object from context.chat.
     */
    function addFavorite(chatInfo, message) {
        // ... (keep existing implementation, ensure message.id is correctly captured)
        if (!chatInfo || !message || message.id === undefined) { // Check message.id existence
            console.error(logPrefix, "addFavorite: Missing chatInfo, message object, or message ID.");
            return;
        }
        const { chatId, type, name, characterId, groupId } = chatInfo;
        const settings = getPluginSettings();

        // Ensure chat entry exists
        if (!settings.chats[chatId]) {
            settings.chats[chatId] = {
                type: type,
                name: name,
                characterId: characterId,
                groupId: groupId,
                count: 0,
                items: [],
            };
        } else {
             settings.chats[chatId].name = name;
             settings.chats[chatId].type = type;
             if (characterId) settings.chats[chatId].characterId = characterId;
             if (groupId) settings.chats[chatId].groupId = groupId;
             if (!settings.chats[chatId].items) settings.chats[chatId].items = [];
             if (typeof settings.chats[chatId].count !== 'number') settings.chats[chatId].count = 0;
        }

        // Use message.id (the index) for messageId
        const messageIdToAdd = String(message.id);

        if (isFavorited(chatId, messageIdToAdd)) {
            console.warn(logPrefix, `Message ${messageIdToAdd} in chat ${chatId} is already favorited.`);
            return;
        }

        const newItem = {
            id: uuidv4(),
            messageId: messageIdToAdd, // Store index as string
            sender: message.name,
            role: message.is_user ? "user" : (message.is_system ? "system" : "character"),
            timestamp: message.send_date,
            note: "",
        };

        settings.chats[chatId].items.push(newItem);
        settings.chats[chatId].count = settings.chats[chatId].items.length;

        console.log(logPrefix, `Favorited message ${messageIdToAdd} in chat ${chatId}. New count: ${settings.chats[chatId].count}`);
        saveSettingsDebounced();

        if (favoritesPopup && favoritesPopup.isShown() && currentPopupChatId === chatId) {
            updateFavoritesPopup(chatId, currentPopupPage);
        }
        renderPluginPage(); // Update plugin page if visible
    }

    /**
     * Removes a favorite by its unique favorite item ID.
     * @param {string} chatId The chat ID.
     * @param {string} favId The unique ID of the favorite item to remove.
     * @returns {boolean} True if removal was successful, false otherwise.
     */
    function removeFavoriteById(chatId, favId) {
        // ... (keep existing implementation)
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];

        if (!chatData || !chatData.items) {
            console.warn(logPrefix, `Cannot remove favorite: Chat ${chatId} not found or has no items.`);
            return false;
        }

        const initialLength = chatData.items.length;
        chatData.items = chatData.items.filter(item => item.id !== favId);
        const removed = chatData.items.length < initialLength;

        if (removed) {
            chatData.count = chatData.items.length;
            console.log(logPrefix, `Removed favorite ${favId} from chat ${chatId}. New count: ${chatData.count}`);

            if (chatData.count === 0) {
                // Don't delete chat entry if it has an associated preview chat?
                 // Or maybe remove the preview association here too?
                 removePreviewChatId(chatId); // Remove preview link if original chat is empty
                 // delete settings.chats[chatId]; // Decide if empty chat entry should be removed
                 console.log(logPrefix, `Removed preview association for empty chat ${chatId}. Consider if chat entry should be deleted.`);
            }
            saveSettingsDebounced();

            if (favoritesPopup && favoritesPopup.isShown() && currentPopupChatId === chatId) {
                 const totalPages = Math.ceil(chatData.count / itemsPerPagePopup);
                 if (currentPopupPage > totalPages && currentPopupPage > 1) {
                     currentPopupPage--;
                 }
                updateFavoritesPopup(chatId, currentPopupPage);
            }
            renderPluginPage(); // Update plugin page if visible
            return true;
        } else {
            console.warn(logPrefix, `Favorite with ID ${favId} not found in chat ${chatId}.`);
            return false;
        }
    }

    /**
     * Removes a favorite based on the original message ID (index).
     * @param {string} chatId The chat ID.
     * @param {string|number} messageId The original message ID (index).
     * @returns {boolean} True if removal was successful, false otherwise.
     */
     function removeFavoriteByMessageId(chatId, messageId) {
        // ... (keep existing implementation, ensure uses string comparison)
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];

        if (!chatData || !chatData.items) {
            return false;
        }

        const stringMessageId = String(messageId); // Convert incoming ID to string
        const favItem = chatData.items.find(item => String(item.messageId) === stringMessageId); // Compare strings

        if (favItem) {
            return removeFavoriteById(chatId, favItem.id);
        } else {
            return false;
        }
    }


    // --- UI Update Functions ---

    /**
     * Updates the visual state of a favorite icon on a specific message.
     * @param {jQuery} $messageElement - The jQuery object for the message container (.mes).
     * @param {boolean} isFav - True to show favorited state, false for default.
     */
    function updateFavoriteIconState($messageElement, isFav) {
        // ... (keep existing implementation)
         const $icon = $messageElement.find(favIconSelector + ' i');
        if ($icon.length) {
            if (isFav) {
                $icon.removeClass(unfavoritedIconClass).addClass(favoritedIconClass);
                $icon.closest(favIconSelector).attr('title', 'Unfavorite Message');
            } else {
                $icon.removeClass(favoritedIconClass).addClass(unfavoritedIconClass);
                 $icon.closest(favIconSelector).attr('title', 'Favorite Message');
            }
        }
    }

    /**
     * Iterates through currently visible messages, injects the favorite icon if missing,
     * and updates its state based on stored data. Also updates the global isPreviewing flag.
     */
    function injectOrUpdateFavoriteIcons() {
        // ---- NEW: Update isPreviewing flag ----
        const currentChatInfo = getCurrentChatInfo();
        isPreviewing = false; // Reset
        if (currentChatInfo) {
            const settings = getPluginSettings();
            // Check if the current chat ID is listed as a preview chat value
            for (const originalId in settings.previews) {
                if (settings.previews[originalId] === currentChatInfo.chatId) {
                    isPreviewing = true;
                    console.log(logPrefix, `Currently in preview mode for original chat ${originalId}`);
                    break;
                }
            }
             // Add a visual indicator if in preview mode
            togglePreviewModeIndicator(isPreviewing);
        }
         // Disable interaction if in preview mode
         toggleInteraction(isPreviewing);
        // ---- End Update ----


        if (!currentChatInfo || isPreviewing) { // Don't inject/update icons in preview mode
             if (isPreviewing) console.log(logPrefix, "Skipping icon injection/update in preview mode.");
            return;
        }

        const chatId = currentChatInfo.chatId;

        $('#chat .mes').each(function() {
            const $messageElement = $(this);
            const $extraButtons = $messageElement.find('.extraMesButtons');
            let $iconContainer = $extraButtons.find(favIconSelector);

            if ($extraButtons.length && $iconContainer.length === 0) {
                $extraButtons.prepend(messageButtonHtml);
                $iconContainer = $extraButtons.find(favIconSelector);
            }

            if ($iconContainer.length > 0) {
                const messageId = $messageElement.attr('mesid'); // mesid usually holds the index
                if (messageId !== undefined) {
                    const isFav = isFavorited(chatId, messageId);
                    updateFavoriteIconState($messageElement, isFav);
                }
            }
        });
    }

    // --- NEW: UI Toggling for Preview Mode ---
    /**
     * Adds or removes a visual indicator for preview mode.
     * @param {boolean} show - True to show the indicator, false to remove.
     */
    function togglePreviewModeIndicator(show) {
        const indicatorId = 'favorites-preview-mode-indicator';
        $(`#${indicatorId}`).remove(); // Clear existing indicator

        if (show) {
            const indicatorHtml = `
                <div id="${indicatorId}" style="
                    background-color: var(--warning-color, orange);
                    color: var(--text-color-contrast, black);
                    text-align: center;
                    padding: 5px;
                    font-weight: bold;
                    position: sticky; /* Keep it visible */
                    top: 0; /* Stick to top of chat area */
                    z-index: 50; /* Above messages */
                ">
                    收藏预览模式 (只读)
                </div>`;
            // Prepend to chat container
            $('#chat').prepend(indicatorHtml);
        }
    }

    /**
     * Enables or disables chat interaction elements.
     * @param {boolean} isPreview - True if currently in preview mode (disable interaction).
     */
     function toggleInteraction(isPreview) {
         const $textarea = $('#send_textarea');
         const $sendButton = $('#send_button'); // Or relevant send button ID
         const $editButtons = $('#chat .mes_edit'); // General selector for edit buttons
         const $deleteButtons = $('#chat .mes_delete'); // General selector for delete buttons
         const $swipeButtons = $('#chat .swipe_left, #chat .swipe_right'); // Swipe buttons
         const $regenerateButton = $('#regenerate_button'); // Regenerate button

         if (isPreview) {
             console.log(logPrefix, "Disabling interaction for preview mode.");
             $textarea.prop('disabled', true).attr('placeholder', '预览模式下禁用输入');
             $sendButton.prop('disabled', true);
             $regenerateButton.prop('disabled', true);
             // Disable buttons within messages - might need more specific selectors if dynamic
             $editButtons.hide(); // Hide instead of disabling?
             $deleteButtons.hide();
             $swipeButtons.hide();
         } else {
             console.log(logPrefix, "Enabling interaction (leaving preview mode or normal chat).");
             $textarea.prop('disabled', false).attr('placeholder', ''); // Restore placeholder if needed
             $sendButton.prop('disabled', false);
             $regenerateButton.prop('disabled', false);
             // Re-enable/show buttons
             $editButtons.show();
             $deleteButtons.show();
             $swipeButtons.show();
         }
     }
     // --- End Preview Mode UI Toggling ---


    // --- Event Handlers ---

    /**
     * Handles clicking the favorite icon on a message. Uses event delegation.
     * @param {Event} event - The click event object.
     */
    function handleFavoriteToggle(event) {
        // Prevent toggling in preview mode
        if (isPreviewing) {
             console.log(logPrefix, "Favorite toggle ignored in preview mode.");
            return;
        }

        const $iconContainer = $(event.target).closest(favIconSelector);
        if (!$iconContainer.length) return;

        const $messageElement = $iconContainer.closest('.mes');
        const messageId = $messageElement.attr('mesid'); // Get index from mesid
        const chatInfo = getCurrentChatInfo();

        if (messageId === undefined || !chatInfo) {
            console.error(logPrefix, "Could not get messageId or chatInfo on toggle.");
            alert("Error: Could not determine message or chat context.");
            return;
        }

        const chatId = chatInfo.chatId;
        const $icon = $iconContainer.find('i');
        const isCurrentlyFavorited = $icon.hasClass(favoritedIconClass);

        updateFavoriteIconState($messageElement, !isCurrentlyFavorited);

        if (!isCurrentlyFavorited) {
            const message = getChatMessageById(messageId); // Get message by index
            if (message) {
                addFavorite(chatInfo, message);
            } else {
                console.error(logPrefix, `Could not find message object for ID ${messageId} to favorite.`);
                alert(`Error: Could not find message data for ID ${messageId}. Cannot favorite.`);
                updateFavoriteIconState($messageElement, false); // Revert visual state
            }
        } else {
            removeFavoriteByMessageId(chatId, messageId);
        }
    }

    /**
     * Handles clicking the sidebar button to open the popup.
     */
    function openFavoritesPopup() {
        // Prevent opening popup in preview mode itself
        if (isPreviewing) {
            toastr.info("收藏夹功能在预览模式中不可用。");
            return;
        }

        const chatInfo = getCurrentChatInfo();
        if (!chatInfo) {
            alert("请先打开一个聊天。");
            return;
        }
        const chatId = chatInfo.chatId;
        currentPopupChatId = chatId;
        currentPopupPage = 1;

        if (!favoritesPopup) {
             const popupHtml = `
                <div class="favorites-popup-content">
                    <h4 id="favorites-popup-title">收藏</h4>
                    <hr>
                    <div id="${popupListContainerId}" class="fav-list-container">
                        <div class="empty-state">加载中...</div>
                    </div>
                    <div id="${popupPaginationId}" class="pagination-controls" style="display: none;">
                        <button id="fav-popup-prev" class="menu_button fa-solid fa-arrow-left" title="上一页"></button>
                        <span id="fav-popup-page-indicator">Page 1 / 1</span>
                        <button id="fav-popup-next" class="menu_button fa-solid fa-arrow-right" title="下一页"></button>
                    </div>
                    <hr>
                    <div class="popup_buttons">
                       <button id="fav-popup-clear-invalid" class="menu_button">清理无效收藏</button>
                       <!--- NEW PREVIEW BUTTON --->
                       <button id="${previewButtonId}" class="menu_button">预览</button>
                       <button id="fav-popup-close" class="menu_button">关闭</button>
                    </div>
                </div>
            `;
            favoritesPopup = new Popup(popupHtml, 'text', '', { okButton: 'none', cancelButton: 'none', wide: true, large: true });

             $(favoritesPopup.dom).on('click', `#${popupListContainerId} .fa-pencil`, handleEditNote);
             $(favoritesPopup.dom).on('click', `#${popupListContainerId} .fa-trash`, handleDeleteFavoriteFromPopup);
             $(favoritesPopup.dom).on('click', '#fav-popup-prev', () => handlePopupPagination('prev'));
             $(favoritesPopup.dom).on('click', '#fav-popup-next', () => handlePopupPagination('next'));
             $(favoritesPopup.dom).on('click', '#fav-popup-clear-invalid', handleClearInvalidFavorites);
             $(favoritesPopup.dom).on('click', '#fav-popup-close', () => favoritesPopup.hide());
             // ---- NEW: Listener for Preview Button ----
             $(favoritesPopup.dom).on('click', `#${previewButtonId}`, handlePreviewClick);

        }

        updateFavoritesPopup(chatId, currentPopupPage);
        favoritesPopup.show();
    }

     /**
     * Renders the content of the favorites popup.
     * @param {string} chatId The chat ID to display favorites for.
     * @param {number} page The page number to display.
     */
    function updateFavoritesPopup(chatId, page = 1) {
        // ... (keep most of the existing implementation)
        if (!favoritesPopup) return;

        currentPopupChatId = chatId;
        currentPopupPage = page;
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        const context = getContext();
         // Check if the provided chatId is the *actually* active chat
        const isCurrentChat = getCurrentChatId() === chatId;

        let title = "收藏";
        let favItems = [];
        let totalItems = 0;

        if (chatData) {
            title = `收藏: ${chatData.name || `Chat ${chatId}`} (${chatData.count})`;
            favItems = [...chatData.items].sort((a, b) => a.timestamp - b.timestamp);
            totalItems = chatData.count;
        } else {
            title = `收藏: Chat ${chatId} (0)`;
        }

        const $popupContent = $(favoritesPopup.dom).find('.favorites-popup-content');
        $popupContent.find('#favorites-popup-title').text(title);

        const $listContainer = $popupContent.find(`#${popupListContainerId}`);
        const $paginationControls = $popupContent.find(`#${popupPaginationId}`);
        const $pageIndicator = $popupContent.find('#fav-popup-page-indicator');
        const $prevButton = $popupContent.find('#fav-popup-prev');
        const $nextButton = $popupContent.find('#fav-popup-next');
        const $clearInvalidButton = $popupContent.find('#fav-popup-clear-invalid');
        // ---- NEW: Get Preview Button ----
        const $previewButton = $popupContent.find(`#${previewButtonId}`);


        if (totalItems === 0) {
            $listContainer.html('<div class="empty-state">此聊天中还没有收藏。</div>');
            $paginationControls.hide();
            $clearInvalidButton.prop('disabled', true);
            $previewButton.prop('disabled', true); // Disable preview if no favorites
            return;
        }

        // ---- NEW: Enable Preview Button if items exist ----
        $previewButton.prop('disabled', false);

        const totalPages = Math.ceil(totalItems / itemsPerPagePopup);
        page = Math.max(1, Math.min(page, totalPages));
        currentPopupPage = page;

        const startIndex = (page - 1) * itemsPerPagePopup;
        const endIndex = startIndex + itemsPerPagePopup;
        const itemsToShow = favItems.slice(startIndex, endIndex);

        let listHtml = '';
        itemsToShow.forEach(favItem => {
            // Pass isCurrentChat to render function
            listHtml += renderFavoriteItem(favItem, isCurrentChat);
        });

        $listContainer.html(listHtml);

        $pageIndicator.text(`第 ${page} / ${totalPages} 页`);
        $prevButton.prop('disabled', page === 1);
        $nextButton.prop('disabled', page === totalPages);
        $paginationControls.show();

        // Enable/disable clear invalid based on whether popup is for the active chat
        $clearInvalidButton.prop('disabled', !isCurrentChat);
        if (!isCurrentChat) {
             $clearInvalidButton.attr('title', '切换到此聊天以清理无效收藏。');
        } else {
             $clearInvalidButton.removeAttr('title');
        }

        $listContainer.scrollTop(0);
    }

    /**
     * Generates HTML for a single favorite item in the popup list.
     * @param {object} favItem The favorite item object from settings.
     * @param {boolean} isCurrentChat Whether the popup is for the currently active chat.
     * @returns {string} HTML string for the list item.
     */
    function renderFavoriteItem(favItem, isCurrentChat) {
        // ... (keep existing implementation, maybe enhance preview)
        let previewText = '';
        let previewClass = '';
        let message = null;

         // Only try to get message if the popup is for the *active* chat
        if (isCurrentChat) {
            message = getChatMessageById(favItem.messageId); // Get message by index
        }

        if (message) {
            previewText = (message.mes || '').substring(0, 100); // Slightly longer preview
            if (message.mes && message.mes.length > 100) previewText += '...';
             previewText = $('<div>').text(previewText).html();
        } else if (isCurrentChat) {
            // Message ID exists in favorites, but not found in current chat array
            previewText = "[消息可能已被删除或聊天已更改]";
            previewClass = 'deleted';
        } else {
             // Popup is for a different chat than the active one
             previewText = "[预览需要切换到此聊天]";
             previewClass = 'requires-switch';
        }


        const formattedTimestamp = favItem.timestamp ? timestampToMoment(favItem.timestamp).format("YYYY-MM-DD HH:mm:ss") : 'N/A';
        const noteDisplay = favItem.note ? `<div class="fav-note">备注: ${$('<div>').text(favItem.note).html()}</div>` : '';

        return `
            <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}">
              <div class="fav-meta">${$('<div>').text(favItem.sender).html()} (${favItem.role}) - ${formattedTimestamp}</div>
              ${noteDisplay}
              <div class="fav-preview ${previewClass}">${previewText}</div>
              <div class="fav-actions">
                <i class="fa-solid fa-pencil" title="编辑备注"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
              </div>
            </div>
        `;
    }

     /** Handles popup pagination clicks */
    function handlePopupPagination(direction) {
        // ... (keep existing implementation)
         if (!favoritesPopup || !currentPopupChatId) return;

        const settings = getPluginSettings();
        const chatData = settings.chats[currentPopupChatId];
        if (!chatData) return;

        const totalPages = Math.ceil(chatData.count / itemsPerPagePopup);

        if (direction === 'prev' && currentPopupPage > 1) {
            currentPopupPage--;
        } else if (direction === 'next' && currentPopupPage < totalPages) {
            currentPopupPage++;
        }
        updateFavoritesPopup(currentPopupChatId, currentPopupPage);
    }


    /** Handles click on the Edit Note icon in the popup */
    async function handleEditNote(event) {
         // ... (keep existing implementation)
          const $itemElement = $(event.target).closest('.favorite-item');
         const favId = $itemElement.data('fav-id');
         const chatId = currentPopupChatId;

         if (!chatId || !favId) return;

         const settings = getPluginSettings();
         const chatData = settings.chats[chatId];
         const favItem = chatData?.items.find(item => item.id === favId);

         if (!favItem) {
             console.error(logPrefix, `Favorite item ${favId} not found for editing note.`);
             return;
         }

         try {
             const result = await callGenericPopup(
                 `为收藏添加备注 (发送者: ${favItem.sender}):`,
                 POPUP_TYPE.INPUT,
                 favItem.note || '',
                 { rows: 3 }
             );

             if (result !== null && result !== undefined) {
                 favItem.note = result.trim();
                 console.log(logPrefix, `Updated note for favorite ${favId} in chat ${chatId}.`);
                 saveSettingsDebounced();
                 const $noteDisplay = $itemElement.find('.fav-note');
                 const escapedNote = $('<div>').text(favItem.note).html();
                  if (favItem.note) {
                      if ($noteDisplay.length) {
                          $noteDisplay.html(`备注: ${escapedNote}`).show();
                      } else {
                          $itemElement.find('.fav-meta').after(`<div class="fav-note">备注: ${escapedNote}</div>`);
                      }
                  } else {
                      $noteDisplay.hide().empty();
                  }
                 renderPluginPage(); // Update plugin page if visible
             }
         } catch (error) {
             console.error(logPrefix, "Error during edit note popup:", error);
         }
     }

     /** Handles click on the Delete icon in the popup */
     async function handleDeleteFavoriteFromPopup(event) {
        // ... (keep existing implementation)
        const $itemElement = $(event.target).closest('.favorite-item');
         const favId = $itemElement.data('fav-id');
         const messageId = $itemElement.data('msg-id');
         const chatId = currentPopupChatId;

         if (!chatId || !favId) return;

         try {
             const confirmation = await callGenericPopup(
                 "确定要移除这条收藏吗？",
                 POPUP_TYPE.CONFIRM
             );

             if (confirmation) {
                 const removed = removeFavoriteById(chatId, favId);
                 if (removed) {
                     if (getCurrentChatId() === chatId) {
                         const $messageElement = $(`#chat .mes[mesid="${messageId}"]`);
                         if ($messageElement.length) {
                             updateFavoriteIconState($messageElement, false);
                         }
                     }
                 }
             }
         } catch (error) {
             console.error(logPrefix, "Error during delete confirmation:", error);
             if (error !== POPUP_RESULT.CANCEL) {
                 alert("删除收藏时发生错误。");
             }
         }
     }

     /** Handles click on the 'Clear Invalid' button in the popup */
    async function handleClearInvalidFavorites() {
        // ... (keep existing implementation, ensure checks context.chat correctly)
         const chatId = currentPopupChatId;
        // Critical: Must be in the chat to check against its context.chat
        if (!chatId || getCurrentChatId() !== chatId) {
            alert("请确保您在正确的聊天中，才能清理无效收藏。");
            return;
        }

        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        if (!chatData || !chatData.items || chatData.items.length === 0) {
            alert("此聊天中没有收藏可检查。");
            return;
        }

        const context = getContext(); // Get current (correct) chat context
        if (!Array.isArray(context.chat)) {
             alert("无法获取当前聊天内容以进行检查。");
             return;
        }
        // Create a set of *existing* message indices (IDs) as strings
        const currentMessageIndices = new Set(context.chat.map((msg, index) => String(index)));

        const invalidFavIds = [];

        chatData.items.forEach(favItem => {
            // Check if the favorite's messageId (string) exists in the set of current indices (strings)
            if (!currentMessageIndices.has(String(favItem.messageId))) {
                invalidFavIds.push(favItem.id);
            }
        });

        if (invalidFavIds.length === 0) {
            alert("未找到无效收藏（所有对应的消息仍然存在）。");
            return;
        }

        try {
            const confirmation = await callGenericPopup(
                `发现 ${invalidFavIds.length} 条收藏指向已删除的消息。要移除它们吗？`,
                POPUP_TYPE.CONFIRM
            );

            if (confirmation) {
                let removedCount = 0;
                invalidFavIds.forEach(favId => {
                    if (removeFavoriteById(chatId, favId)) {
                        removedCount++;
                    }
                });
                console.log(logPrefix, `Cleared ${removedCount} invalid favorites from chat ${chatId}.`);
                if(removedCount > 0) {
                    alert(`移除了 ${removedCount} 条无效收藏。`);
                    // updateFavoritesPopup is called within removeFavoriteById
                    updateFavoritesPopup(chatId, currentPopupPage); // Explicitly refresh just in case
                } else {
                     alert("未移除无效收藏（操作可能失败）。");
                }
            }
        } catch (error) {
             console.error(logPrefix, "Error during clear invalid confirmation:", error);
             if (error !== POPUP_RESULT.CANCEL) {
                 alert("清理无效收藏时发生错误。");
             }
        }
    }

    // --- NEW: Preview Button Handler and Helper ---
    /**
     * Orchestrates the preview process.
     */
    async function handlePreviewClick() {
        console.log(logPrefix, "Preview button clicked.");
        toastr.info("正在准备预览...");

        // 1. Get context of the *original* chat (where the popup was opened)
        const originalChatId = currentPopupChatId;
        const originalContext = getContext(); // Context when button is clicked
        const originalChatInfo = getCurrentChatInfo(); // Get info like type, charId, groupId

        if (!originalChatInfo || originalChatInfo.chatId !== originalChatId) {
            console.error(logPrefix, "Mismatch between popup context and current chat. Aborting preview.");
            alert("错误：无法确定原始聊天上下文以进行预览。");
            return;
        }

        // Safety check: Ensure not generating/saving in the original chat
        // Need to import is_send_press, is_group_generating, isChatSaving
        // import { is_send_press, isChatSaving } from '../../../../script.js';
        // import { is_group_generating } from '../../../group-chats.js'; // Adjust path
        // if (is_send_press || is_group_generating || isChatSaving) {
        //     toastr.warning("请等待当前操作完成后再预览。");
        //     console.warn(logPrefix, "Preview aborted due to ongoing operation.");
        //     return;
        // }

        // 2. Get full favorite messages *from the original context*
        const messagesToFill = await getFullFavoriteMessages(originalChatId);

        if (!messagesToFill || messagesToFill.length === 0) {
            alert("此聊天中没有可预览的收藏。");
            console.log(logPrefix, "No favorite messages found to preview.");
            return;
        }

        // 3. Hide the popup immediately
        if (favoritesPopup) {
            favoritesPopup.hide();
        }

        // 4. Check if preview chat exists
        const existingPreviewId = getPreviewChatId(originalChatId);

        try {
            if (existingPreviewId) {
                console.log(logPrefix, `Found existing preview chat ${existingPreviewId}. Switching...`);
                // 5a. Switch to existing preview chat
                if (originalChatInfo.type === 'group' && originalChatInfo.groupId) {
                    await openGroupChat(originalChatInfo.groupId, existingPreviewId);
                } else if (originalChatInfo.type === 'private' && originalChatInfo.characterId !== undefined) {
                     // Find the character filename/object if needed by openCharacterChat
                     // Assuming openCharacterChat takes character ID and chat ID? Check SillyTavern source/docs.
                     // Let's assume it switches context based on characterId first, then finds the chat.
                     // Or maybe need await selectCharacterById(originalChatInfo.characterId); first?
                     // Simpler approach: openCharacterChat might just take the chat ID directly if ST manages context.
                     // Let's try with just chat ID first, assuming ST handles the character context.
                     // If not, we need the character file_name.
                    await openCharacterChat(null, existingPreviewId); // Try null for file_name, pass chat ID
                     // If the above fails, need to get character filename:
                     // const character = originalContext.characters.find(c => c.id === originalChatInfo.characterId);
                     // if (character) await openCharacterChat(character.avatar, existingPreviewId); else throw new Error('Character not found');
                } else {
                    throw new Error("无法确定原始聊天的类型（角色或群组）。");
                }
                // Wait briefly for context switch
                await new Promise(resolve => setTimeout(resolve, 500)); // Adjust timing if needed
                console.log(logPrefix, "Switched to existing preview chat. Performing clear and refill...");
                await performClearAndRefill(messagesToFill);

            } else {
                console.log(logPrefix, "No existing preview chat found. Creating new one...");
                // 5b. Create new chat
                await doNewChat({ deleteCurrentChat: false });
                // Wait for new chat creation and context update
                await new Promise(resolve => setTimeout(resolve, 500)); // Adjust timing

                // Get the new chat's context and ID
                const newPreviewContext = getContext();
                const newPreviewChatId = getCurrentChatId();

                if (!newPreviewChatId) {
                    throw new Error("未能获取新创建的预览聊天的ID。");
                }
                console.log(logPrefix, `Created new chat with ID: ${newPreviewChatId}. Renaming...`);

                // Rename the new chat (ensure renameChat works in current context)
                try {
                    await renameChat(previewChatName); // Call renameChat in the new context
                     console.log(logPrefix, `Renamed new chat to "${previewChatName}".`);
                } catch (renameError) {
                     console.error(logPrefix, "Failed to rename preview chat:", renameError);
                     toastr.warning("无法重命名预览聊天，但仍会继续填充。");
                }


                // Associate new preview ID with original chat ID
                setPreviewChatId(originalChatId, newPreviewChatId);

                console.log(logPrefix, "Performing initial fill...");
                await performClearAndRefill(messagesToFill); // Perform fill (clear is redundant for new chat but safe)
            }
            toastr.success("已进入收藏预览模式。");
        } catch (error) {
            console.error(logPrefix, "Error during preview process:", error);
            alert(`创建或切换到预览聊天时出错: ${error.message}`);
            toastr.error("预览操作失败。");
        }
    }

    /**
     * Clears the current chat and fills it with the provided messages.
     * Should be called *after* switching to the preview chat context.
     * @param {object[]} messagesToFill - Array of full message objects to display.
     */
    async function performClearAndRefill(messagesToFill) {
        console.log(logPrefix, "Performing clear and refill operation...");
        const context = getContext(); // Get context of the *preview* chat

        // 1. Clear chat content
        console.log(logPrefix, "Clearing chat...");
        await clearChat(); // Use await if clearChat is async, otherwise just call it
        // Wait for clear operation and DOM update
        await new Promise(resolve => setTimeout(resolve, 300)); // Adjust timing
        console.log(logPrefix, "Chat cleared.");

        // 2. Determine truncation limit
        // Access power_user settings via context
        const powerUserSettings = context.powerUserSettings || {}; // Get power user settings from context
        const truncationLimit = powerUserSettings.chat_truncation > 0 ? powerUserSettings.chat_truncation : null; // Get limit, null if 0 or unset

        console.log(logPrefix, `Truncation limit: ${truncationLimit === null ? 'None' : truncationLimit}`);

        // 3. Slice messages if limit applies (take the *latest* messages)
        const limitedMessages = truncationLimit !== null ? messagesToFill.slice(-truncationLimit) : messagesToFill;
        console.log(logPrefix, `Filling with ${limitedMessages.length} messages (after truncation).`);


        // 4. Add messages one by one
        for (let i = 0; i < limitedMessages.length; i++) {
            const message = limitedMessages[i];
            try {
                 // console.log(logPrefix, `Adding message index ${i} (Original ID: ${message.id}): ${message.mes.substring(0, 30)}...`);
                 // Use forceId with the *original* message index/id
                 // Make sure addOneMessage is available on context or globally
                 await context.addOneMessage(message, {
                     scroll: (i === limitedMessages.length - 1), // Only scroll on the last message
                     forceId: message.id // Try to force original ID (index)
                 });
                 // Brief delay between messages can help rendering order
                 await new Promise(resolve => setTimeout(resolve, 50)); // Short delay
            } catch (addError) {
                console.error(logPrefix, `Error adding message (Original ID: ${message.id}):`, addError);
            }
        }

        // 5. Update UI (indicator, disable interaction) - Called by injectOrUpdateFavoriteIcons via CHAT_CHANGED event listener

        console.log(logPrefix, "Clear and refill complete.");
    }
    // --- End Preview Handlers ---


    // --- Plugin Page (Settings Overview) Functions ---
    // ... (keep existing implementation, maybe add preview chat info?)
    function renderPluginPage(page = 1) {
         // ... (existing code) ...
         // Modification Idea: Display if a chat has an associated preview chat?
         // Need to iterate through settings.previews to check.
        const $settingsArea = $(`#${settingsContainerId}`);
        if (!$settingsArea.length) return; // Container not injected yet

        const settings = getPluginSettings();
        const allChats = settings.chats || {};
        const chatIds = Object.keys(allChats);

        if (chatIds.length === 0) {
            $settingsArea.html('<div class="empty-state">No favorites found across any chats yet.</div>');
            return;
        }

        // Group chats by character/group name for display
        const groupedChats = {};
        const context = getContext(); // Get context to try and find current names
         // Create a reverse map for quick lookup: previewId -> originalId
        const previewIdToOriginalId = {};
        for (const origId in settings.previews) {
            previewIdToOriginalId[settings.previews[origId]] = origId;
        }


        chatIds.forEach(chatId => {
             // ---- NEW: Skip listing preview chats themselves ----
            if (previewIdToOriginalId[chatId]) {
                 console.log(logPrefix, `Skipping listing of preview chat ${chatId} in plugin page.`);
                return; // Don't list the preview chat entry
            }
            // ---- End Skip ----


            const chatData = allChats[chatId];
            let groupKey = "Unknown / Other";
            let displayName = chatData.name || `Chat ${chatId}`; // Use stored name first
            let hasPreview = !!settings.previews[chatId]; // Check if this chat has a preview

            if (chatData.type === "private" && chatData.characterId) {
                const character = context.characters?.find(c => c.id === chatData.characterId);
                groupKey = character ? character.name : displayName; // Use current char name if found
            } else if (chatData.type === "group" && chatData.groupId) {
                const group = context.groups?.find(g => g.id === chatData.groupId);
                groupKey = group ? group.name : displayName; // Use current group name if found
            }

            if (!groupedChats[groupKey]) {
                groupedChats[groupKey] = [];
            }
            groupedChats[groupKey].push({
                chatId: chatId,
                displayName: displayName, // Display potentially old name if current not found
                count: chatData.count || 0,
                hasPreview: hasPreview, // Add flag
            });
        });

        // Sort groups alphabetically, then chats within groups
        const sortedGroupKeys = Object.keys(groupedChats).sort((a, b) => a.localeCompare(b));

        let allEntries = [];
        sortedGroupKeys.forEach(groupKey => {
             allEntries.push({ isGroupTitle: true, title: groupKey });
            const sortedChats = groupedChats[groupKey].sort((a, b) => a.displayName.localeCompare(b.displayName));
             allEntries = allEntries.concat(sortedChats);
        });


        const totalEntries = allEntries.length; // Includes titles
        const totalPages = Math.ceil(totalEntries / itemsPerPagePluginPage);
        page = Math.max(1, Math.min(page, totalPages));
        currentPluginPagePage = page;

        const startIndex = (page - 1) * itemsPerPagePluginPage;
        const endIndex = startIndex + itemsPerPagePluginPage;
        const entriesToShow = allEntries.slice(startIndex, endIndex);

        let contentHtml = `<div id="${pluginPageListContainerId}" class="chat-list-container">`;
        entriesToShow.forEach(entry => {
            if (entry.isGroupTitle) {
                contentHtml += `<div class="chat-group-title">${$('<div>').text(entry.title).html()}</div>`;
            } else {
                 // Add preview indicator (optional)
                 const previewIndicator = entry.hasPreview ? ' <i class="fa-solid fa-eye fa-xs" title="Has Preview Chat"></i>' : '';
                contentHtml += `
                    <div class="chat-entry-item" data-chat-id="${entry.chatId}" title="Click to view favorites for ${$('<div>').text(entry.displayName).html()}">
                        <span>${$('<div>').text(entry.displayName).html()}${previewIndicator}</span>
                        <span class="count">(${entry.count})</span>
                    </div>`;
            }
        });
        contentHtml += `</div>`; // Close list container

        // Add pagination
        if (totalPages > 1) {
            contentHtml += `
                <div id="${pluginPagePaginationId}" class="pagination-controls">
                    <button id="fav-plugin-prev" class="menu_button fa-solid fa-arrow-left" title="Previous Page" ${page === 1 ? 'disabled' : ''}></button>
                    <span id="fav-plugin-page-indicator">Page ${page} / ${totalPages}</span>
                    <button id="fav-plugin-next" class="menu_button fa-solid fa-arrow-right" title="Next Page" ${page === totalPages ? 'disabled' : ''}></button>
                </div>`;
        }

        $settingsArea.html(contentHtml);
        setupPluginPageEventDelegation(); // Re-run setup after render
    }

     /** Handles plugin page pagination clicks */
     function handlePluginPagePagination(direction) {
         // ... (keep existing implementation, maybe adjust totalPages calc if previews are excluded)
        const settings = getPluginSettings();
        const allChats = settings.chats || {};
        const previewIds = new Set(Object.values(settings.previews)); // Get IDs that ARE previews

        // Calculate total pages excluding preview chats and including titles
        let entryCountForPaging = 0;
        const groupedChats = {};
        Object.keys(allChats).forEach(chatId => {
            if (previewIds.has(chatId)) return; // Skip preview chats

            const chatData = allChats[chatId];
            let groupKey = "Unknown / Other";
            if (chatData.type === "private" && chatData.characterId) groupKey = chatData.name || `Char ${chatData.characterId}`;
            else if (chatData.type === "group" && chatData.groupId) groupKey = chatData.name || `Group ${chatData.groupId}`;

            if (!groupedChats[groupKey]) {
                groupedChats[groupKey] = true;
                entryCountForPaging++; // Count group title
            }
            entryCountForPaging++; // Count chat entry
        });

         const totalPages = Math.ceil(entryCountForPaging / itemsPerPagePluginPage);


         if (direction === 'prev' && currentPluginPagePage > 1) {
             currentPluginPagePage--;
         } else if (direction === 'next' && currentPluginPagePage < totalPages) {
             currentPluginPagePage++;
         }
         renderPluginPage(currentPluginPagePage);
     }


    /** Handles clicks on chat entries within the plugin settings page */
    function handlePluginPageChatClick(event) {
        // ... (keep existing implementation)
         const $chatEntry = $(event.target).closest('.chat-entry-item');
        if (!$chatEntry.length) return;

        const clickedChatId = $chatEntry.data('chat-id');
        if (clickedChatId) {
             console.log(logPrefix, `Opening favorites popup for chat ${clickedChatId} from plugin page.`);
            currentPopupChatId = clickedChatId;
            currentPopupPage = 1;
             if(!favoritesPopup) {
                 openFavoritesPopup();
             } else {
                 // Need to ensure the main UI is actually in the clickedChatId context
                 // before calling updateFavoritesPopup if it relies on context.chat
                 // Best practice: Switch chat first if needed, then open popup.
                 // For now, we assume updateFavoritesPopup can handle inactive chat data
                 // or gets data solely from settings.
                 const isActive = getCurrentChatId() === clickedChatId;
                 if (isActive) {
                    updateFavoritesPopup(clickedChatId, currentPopupPage); // Update existing popup
                    favoritesPopup.show();
                 } else {
                      // If not active, maybe just show basic info from settings?
                      // Or prompt user to switch?
                      alert("请先切换到目标聊天，然后再从插件页面打开收藏夹。");
                      // Alternatively, make updateFavoritesPopup fully rely on settings:
                      // updateFavoritesPopup(clickedChatId, currentPopupPage);
                      // favoritesPopup.show();
                 }
             }
        }
    }

    /** Sets up event delegation for the plugin page list and pagination */
    function setupPluginPageEventDelegation() {
        // ... (keep existing implementation)
        const $settingsArea = $(`#${settingsContainerId}`);
        $settingsArea.off('click', '.chat-entry-item');
        $settingsArea.off('click', '#fav-plugin-prev');
        $settingsArea.off('click', '#fav-plugin-next');

        $settingsArea.on('click', '.chat-entry-item', handlePluginPageChatClick);
        $settingsArea.on('click', '#fav-plugin-prev', () => handlePluginPagePagination('prev'));
        $settingsArea.on('click', '#fav-plugin-next', () => handlePluginPagePagination('next'));
    }


    // --- Plugin Initialization ---
    jQuery(async () => {
        console.log(logPrefix, "Loading...");
        initializeSettings();

        // 1. Inject into Extensions Page
        try {
            // Use the existing settings_display.html template name
            const settingsHtml = await renderExtensionTemplateAsync(pluginFolderName, 'settings_display'); // Use folder name
             let $container = $('#extensions_settings');
             if (!$container.length) $container = $('#extension_settings_container'); // Fallback ID
             if (!$container.length) $container = $('#extensionsContainer'); // Another common ID
             if (!$container.length) $container = $('#translation_tabs > .tab-content'); // Last resort guess

             if($container.length) {
                $container.append(settingsHtml);
                // Inject the dynamic area *into* the loaded template
                 $container.find('.inline-drawer-content').append(`<div id="${settingsContainerId}">Loading favorites overview...</div>`);
                 console.log(logPrefix, `Added settings UI container and dynamic area to ${$container.prop('tagName')}#${$container.attr('id') || ''}`);
                 renderPluginPage(currentPluginPagePage);
                 setupPluginPageEventDelegation();
             } else {
                 console.error(logPrefix, "Could not find suitable container for settings UI.");
             }
        } catch (error) {
            console.error(logPrefix, "Failed to load or inject settings_display.html:", error);
        }


        // 2. Inject Sidebar Button (using your input_button.html)
        try {
            // Use the existing input_button.html template name
            const sidebarButtonHtml = await renderExtensionTemplateAsync(pluginFolderName, 'input_button'); // Use folder name
            // Inject next to other input buttons if possible
            // Common containers: #chat_input_buttons, #right-nav-panel, #extensions_placeholder
             let $buttonContainer = $('#chat_input_buttons');
             if (!$buttonContainer.length) $buttonContainer = $('#right-nav-panel .list-group').first(); // Try right panel
             if (!$buttonContainer.length) $buttonContainer = $('#data_bank_wand_container'); // Fallback to original

            if ($buttonContainer.length) {
                 // Use the ID from your input_button.html ('favorites_button')
                 $buttonContainer.append(sidebarButtonHtml);
                 console.log(logPrefix, `Added input button to ${$buttonContainer.prop('tagName')}#${$buttonContainer.attr('id') || ''}`);
                 // Attach listener using the ID from input_button.html
                 $(document).on('click', `#favorites_button`, openFavoritesPopup);
            } else {
                 console.error(logPrefix, "Could not find suitable container for input button.");
            }

        } catch (error) {
            console.error(logPrefix, "Failed to load or inject input_button.html:", error);
        }


        // 3. Setup Message Button Injection & Event Delegation
        injectOrUpdateFavoriteIcons();
        $(document).on('click', favIconSelector, handleFavoriteToggle);
        console.log(logPrefix, `Set up event delegation for ${favIconSelector}`);


        // 4. Listen for SillyTavern events
        // Use CHAT_CHANGED for robust context updates (includes loading, switching)
        eventSource.on(event_types.CHAT_CHANGED, () => {
             console.log(logPrefix, "CHAT_CHANGED event detected.");
             injectOrUpdateFavoriteIcons(); // Handles isPreviewing flag, UI state, and icons
             // Close popup if chat changes? Optional, depends on desired UX.
             // if (favoritesPopup && favoritesPopup.isShown() && getCurrentChatId() !== currentPopupChatId) {
             //     favoritesPopup.hide();
             // }
        });

        // Optional: Update icons when a message is added/edited/deleted if needed
        eventSource.on(event_types.MESSAGE_SENT, injectOrUpdateFavoriteIcons);
        eventSource.on(event_types.MESSAGE_RECEIVED, injectOrUpdateFavoriteIcons);
        eventSource.on(event_types.MESSAGE_EDITED, injectOrUpdateFavoriteIcons);
        eventSource.on(event_types.MESSAGE_DELETED, injectOrUpdateFavoriteIcons); // Might need delay

        // Listen for setting changes (e.g., if another tab modified favorites)
        // eventSource.on(event_types.SETTINGS_UPDATED, () => {
        //      console.log(logPrefix, "SETTINGS_UPDATED event detected.");
        //      initializeSettings(); // Re-ensure settings structure
        //      injectOrUpdateFavoriteIcons();
        //      renderPluginPage(); // Refresh overview
        // });


        console.log(logPrefix, "Loaded successfully.");
    });

})(); // End IIFE
