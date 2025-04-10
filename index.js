// 收藏插件 - 标记、管理和预览重要消息
import { renderExtensionTemplateAsync, getContext, extension_settings } from '../../../extensions.js';
import { 
    doNewChat, 
    is_send_press, 
    isChatSaving, 
    this_chid, 
    clearChat, 
    renameChat, 
    openCharacterChat 
} from "../../../../script.js";
import { selected_group, is_group_generating, openGroupChat } from "../../../group-chats.js";

// 插件名称常量
const pluginName = 'star2';

// 保存插件设置的辅助函数
function savePluginSettings() {
    // 保存插件设置
    extension_settings[pluginName] = extension_settings[pluginName] || {};
    localStorage.setItem('extensions', JSON.stringify(extension_settings));
}

// 确保收藏数组存在
function ensureFavoritesArrayExists() {
    if (!extension_settings[pluginName]) {
        extension_settings[pluginName] = {};
    }
    
    // 获取当前聊天的ID
    const context = getContext();
    const chatId = context.chatId;
    
    if (!extension_settings[pluginName].chats) {
        extension_settings[pluginName].chats = {};
    }
    
    if (!extension_settings[pluginName].chats[chatId]) {
        extension_settings[pluginName].chats[chatId] = {
            items: []
        };
    }
    
    // 确保预览聊天IDs对象存在
    if (!extension_settings[pluginName].previewChatIds) {
        extension_settings[pluginName].previewChatIds = {};
    }
    
    savePluginSettings();
    return chatId;
}

// 添加收藏
function addFavorite(messageInfo) {
    const chatId = ensureFavoritesArrayExists();
    const items = extension_settings[pluginName].chats[chatId].items;
    
    // 检查是否已经收藏过
    const isAlreadyFavorite = items.some(item => item.messageId === messageInfo.id);
    
    if (isAlreadyFavorite) {
        console.log(`[${pluginName}] 消息 ${messageInfo.id} 已经收藏过`);
        return false;
    }
    
    // 创建新的收藏项
    const newFavorite = {
        id: Date.now().toString(), // 唯一ID
        messageId: messageInfo.id,
        character: messageInfo.name,
        preview: messageInfo.mes.substring(0, 50) + (messageInfo.mes.length > 50 ? '...' : ''),
        timestamp: Date.now(),
        note: '' // 可选备注
    };
    
    // 添加到收藏列表
    items.push(newFavorite);
    savePluginSettings();
    
    console.log(`[${pluginName}] 已收藏消息:`, newFavorite);
    return true;
}

// 通过收藏ID删除收藏
function removeFavoriteById(favoriteId) {
    const chatId = ensureFavoritesArrayExists();
    const items = extension_settings[pluginName].chats[chatId].items;
    
    const initialLength = items.length;
    
    // 移除指定ID的收藏
    const newItems = items.filter(item => item.id !== favoriteId);
    
    // 如果长度变化了，说明找到并移除了
    if (newItems.length !== initialLength) {
        extension_settings[pluginName].chats[chatId].items = newItems;
        savePluginSettings();
        console.log(`[${pluginName}] 已删除收藏 ID:${favoriteId}`);
        return true;
    }
    
    console.log(`[${pluginName}] 未找到收藏 ID:${favoriteId}`);
    return false;
}

// 通过消息ID删除收藏
function removeFavoriteByMessageId(messageId) {
    const chatId = ensureFavoritesArrayExists();
    const items = extension_settings[pluginName].chats[chatId].items;
    
    const initialLength = items.length;
    
    // 移除指定消息ID的收藏
    const newItems = items.filter(item => item.messageId !== messageId);
    
    // 如果长度变化了，说明找到并移除了
    if (newItems.length !== initialLength) {
        extension_settings[pluginName].chats[chatId].items = newItems;
        savePluginSettings();
        console.log(`[${pluginName}] 已删除消息ID为 ${messageId} 的收藏`);
        return true;
    }
    
    console.log(`[${pluginName}] 未找到消息ID为 ${messageId} 的收藏`);
    return false;
}

// 更新收藏备注
function updateFavoriteNote(favoriteId, note) {
    const chatId = ensureFavoritesArrayExists();
    const items = extension_settings[pluginName].chats[chatId].items;
    
    // 找到指定ID的收藏
    const favorite = items.find(item => item.id === favoriteId);
    
    if (favorite) {
        favorite.note = note;
        savePluginSettings();
        console.log(`[${pluginName}] 已更新收藏 ID:${favoriteId} 的备注`);
        return true;
    }
    
    console.log(`[${pluginName}] 未找到收藏 ID:${favoriteId}`);
    return false;
}

// 处理收藏图标的点击切换
function handleFavoriteToggle(event) {
    const target = $(event.currentTarget);
    const messageBlock = target.closest('.mes');
    const messageId = messageBlock.attr('mesid');
    
    // 查找完整消息
    const context = getContext();
    const message = context.chat.find(msg => String(msg.id || msg.index) === messageId); 
    
    if (!message) {
        console.error(`[${pluginName}] 无法找到消息 ID:${messageId}`);
        toastr.error('无法找到该消息');
        return;
    }
    
    const isFavorite = target.hasClass('favorite-marked');
    
    if (isFavorite) {
        // 取消收藏
        const success = removeFavoriteByMessageId(messageId);
        if (success) {
            target.removeClass('favorite-marked');
            toastr.info('已取消收藏该消息');
        } else {
            toastr.error('取消收藏失败');
        }
    } else {
        // 添加收藏
        const success = addFavorite(message);
        if (success) {
            target.addClass('favorite-marked');
            toastr.success('已收藏该消息');
        } else {
            toastr.info('该消息已经收藏过了');
        }
    }
    
    // 刷新收藏弹窗，如果已打开
    const favoritesPopup = $('#favorites_popup');
    if (favoritesPopup.is(':visible')) {
        updateFavoritesPopup();
    }
}

// 添加收藏图标到所有消息
function addFavoriteIconsToMessages() {
    ensureFavoritesArrayExists();
    
    // 向每个消息添加收藏图标，如果尚未添加
    $('.mes').each(function() {
        if ($(this).find('.favorite-button').length === 0) {
            const messageId = $(this).attr('mesid');
            const extraButtonsContainer = $(this).find('.extraMesButtons');
            
            if (extraButtonsContainer.length > 0) {
                // 创建收藏按钮
                const favoriteButton = $(`
                    <div class="mes_button favorite-button" title="收藏此消息">
                        <i class="fa-star fa-solid"></i>
                    </div>
                `);
                
                // 检查是否已收藏
                const context = getContext();
                const chatId = context.chatId;
                
                if (extension_settings[pluginName]?.chats?.[chatId]?.items) {
                    const isFavorite = extension_settings[pluginName].chats[chatId].items.some(
                        item => String(item.messageId) === String(messageId)
                    );
                    
                    if (isFavorite) {
                        favoriteButton.addClass('favorite-marked');
                    }
                }
                
                // 添加到消息按钮容器
                extraButtonsContainer.append(favoriteButton);
            }
        }
    });
}

// 刷新视图中的收藏图标
function refreshFavoriteIconsInView() {
    ensureFavoritesArrayExists();
    
    const context = getContext();
    const chatId = context.chatId;
    
    // 如果没有收藏数据，则直接返回
    if (!extension_settings[pluginName]?.chats?.[chatId]?.items) {
        return;
    }
    
    const favoriteMessageIds = extension_settings[pluginName].chats[chatId].items.map(
        item => String(item.messageId)
    );
    
    // 更新所有消息的收藏图标状态
    $('.mes').each(function() {
        const messageId = String($(this).attr('mesid'));
        const favoriteButton = $(this).find('.favorite-button');
        
        if (favoriteButton.length > 0) {
            if (favoriteMessageIds.includes(messageId)) {
                favoriteButton.addClass('favorite-marked');
            } else {
                favoriteButton.removeClass('favorite-marked');
            }
        }
    });
}

// 渲染单个收藏项
function renderFavoriteItem(favItem, index) {
    return `
        <div class="favorite-item" data-favorite-id="${favItem.id}" data-message-id="${favItem.messageId}">
            <div class="favorite-header">
                <span class="favorite-character">${favItem.character}</span>
                <span class="favorite-number">#${index + 1}</span>
            </div>
            <div class="favorite-content">${favItem.preview}</div>
            <div class="favorite-note ${favItem.note ? '' : 'empty-note'}">
                ${favItem.note || '添加备注...'}
            </div>
            <div class="favorite-actions">
                <button class="favorite-edit-note">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="favorite-delete">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

// 预览收藏消息
async function handlePreviewFavorites() {
    console.log(`[${pluginName}] 预览按钮被点击`);
    
    try {
        // 检查是否有角色或群组被选中
        if (selected_group === null && this_chid === undefined) {
            console.error(`[${pluginName}] 错误: 没有选择角色或群组`);
            toastr.error('请先选择一个角色或群组');
            return;
        }

        // 检查是否正在生成或保存，避免冲突
        if (is_send_press || is_group_generating) {
            console.error(`[${pluginName}] 错误: 正在生成回复，无法创建预览聊天`);
            toastr.warning('正在生成回复，请稍后再试');
            return;
        }
        if (isChatSaving) {
            console.error(`[${pluginName}] 错误: 聊天正在保存，无法创建预览聊天`);
            toastr.warning('聊天正在保存，请稍后再试');
            return;
        }

        // 获取当前上下文和聊天消息
        const context = getContext();
        const chatId = context.chatId;
        const characterId = context.characterId;
        const groupId = context.groupId;
        const originalChat = [...context.chat]; // 复制当前聊天数组
        
        // 确保预览聊天IDs对象存在
        ensureFavoritesArrayExists();
        
        // 获取收藏项
        const favItems = extension_settings[pluginName].chats[chatId]?.items || [];
        
        if (favItems.length === 0) {
            console.error(`[${pluginName}] 错误: 没有收藏的消息可以预览`);
            toastr.warning('没有收藏的消息可以预览');
            return;
        }
        
        console.log(`[${pluginName}] 当前聊天共有 ${favItems.length} 条收藏消息`);
        
        // 收集完整的收藏消息
        const fullMessagesToPreview = [];
        for (const favItem of favItems) {
            const fullMessage = originalChat.find(msg => String(msg.id || msg.index) === String(favItem.messageId));
            if (fullMessage) {
                // 创建消息的深拷贝，避免引用原始对象
                const messageCopy = JSON.parse(JSON.stringify(fullMessage));
                fullMessagesToPreview.push(messageCopy);
            } else {
                console.warn(`[${pluginName}] 警告: 未找到收藏的消息 ID:${favItem.messageId}`);
            }
        }
        
        if (fullMessagesToPreview.length === 0) {
            console.error(`[${pluginName}] 错误: 所有收藏的消息都无法找到`);
            toastr.error('所有收藏的消息都无法找到');
            return;
        }
        
        console.log(`[${pluginName}] 找到 ${fullMessagesToPreview.length} 条有效收藏消息`);
        
        // 检查是否已有预览聊天ID
        const previewChatId = extension_settings[pluginName].previewChatIds[chatId];
        
        if (!previewChatId) {
            // 创建新的预览聊天
            console.log(`[${pluginName}] 没有找到预览聊天ID，创建新的预览聊天...`);
            
            // 创建新聊天并切换
            await doNewChat({ deleteCurrentChat: false });
            
            // 获取新创建的聊天ID
            const newContext = getContext();
            const newPreviewChatId = newContext.chatId;
            
            // 重命名聊天
            await renameChat(newPreviewChatId, "<收藏预览>");
            
            // 保存预览聊天ID与原聊天的关联
            extension_settings[pluginName].previewChatIds[chatId] = newPreviewChatId;
            savePluginSettings();
            
            console.log(`[${pluginName}] 已创建预览聊天 ID:${newPreviewChatId} 并与原聊天 ID:${chatId} 关联`);
        } else {
            // 切换到已有的预览聊天
            console.log(`[${pluginName}] 找到预览聊天ID:${previewChatId}，正在切换...`);
            
            if (selected_group !== null) {
                // 群组聊天
                await openGroupChat(groupId, previewChatId);
            } else {
                // 角色聊天
                await openCharacterChat(characterId, previewChatId);
            }
            
            console.log(`[${pluginName}] 已切换到预览聊天 ID:${previewChatId}`);
        }
        
        // 延迟一下确保聊天已切换
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 清空当前聊天
        console.log(`[${pluginName}] 清空预览聊天...`);
        clearChat();
        
        // 再次延迟，确保清空操作完成
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // 获取当前上下文
        const previewContext = getContext();
        
        // 将收藏消息按原始顺序排序
        fullMessagesToPreview.sort((a, b) => {
            // 尝试使用id排序，如果没有则使用index
            const idA = a.id || a.index || 0;
            const idB = b.id || b.index || 0;
            return idA - idB;
        });
        
        // 添加收藏消息到预览聊天
        console.log(`[${pluginName}] 开始填充收藏消息到预览聊天...`);
        
        let addedCount = 0;
        for (const message of fullMessagesToPreview) {
            try {
                const previewId = message.id || message.index;
                console.log(`[${pluginName}] 添加消息 ID:${previewId}: ${message.mes.substring(0, 30)}...`);
                
                await previewContext.addOneMessage(message, { 
                    scroll: true,
                    forceId: previewId
                });
                
                // 短暂延迟确保顺序正确
                await new Promise(resolve => setTimeout(resolve, 100));
                
                addedCount++;
            } catch (error) {
                console.error(`[${pluginName}] 添加消息时出错:`, error);
            }
        }
        
        console.log(`[${pluginName}] 预览完成，共添加了 ${addedCount} 条收藏消息`);
        toastr.success(`收藏预览已加载，共显示 ${addedCount} 条收藏消息`);
        
    } catch (error) {
        console.error(`[${pluginName}] 预览收藏时发生错误:`, error);
        toastr.error('预览收藏时出错，请查看控制台');
    }
}

// 更新收藏弹窗内容
function updateFavoritesPopup() {
    const chatId = ensureFavoritesArrayExists();
    const favItems = extension_settings[pluginName].chats[chatId].items;
    
    // 获取弹窗内容区域
    const popupContent = $('#favorites_popup_content');
    
    // 清空现有内容
    popupContent.empty();
    
    // 添加预览按钮
    const previewButton = $(`
        <div class="favorites-preview-button">
            <button id="preview_favorites_button">
                <i class="fa-solid fa-eye"></i> 预览全部
            </button>
        </div>
    `);
    
    popupContent.append(previewButton);
    
    // 绑定预览按钮点击事件
    $('#preview_favorites_button').off('click').on('click', async function() {
        // 关闭弹窗
        $('#favorites_popup').hide();
        
        // 执行预览
        await handlePreviewFavorites();
    });
    
    // 添加收藏项容器
    const favoritesContainer = $('<div class="favorites-container"></div>');
    popupContent.append(favoritesContainer);
    
    if (favItems.length === 0) {
        favoritesContainer.append('<div class="no-favorites">没有收藏的消息</div>');
        return;
    }
    
    // 添加收藏项
    favItems.forEach((favItem, index) => {
        const itemHtml = renderFavoriteItem(favItem, index);
        const itemElement = $(itemHtml);
        
        // 绑定删除按钮点击事件
        itemElement.find('.favorite-delete').on('click', async function() {
            const favoriteId = $(this).closest('.favorite-item').data('favorite-id');
            const messageId = $(this).closest('.favorite-item').data('message-id');
            await handleDeleteFavoriteFromPopup(favoriteId, messageId);
        });
        
        // 绑定编辑备注按钮点击事件
        itemElement.find('.favorite-edit-note').on('click', async function() {
            const favoriteId = $(this).closest('.favorite-item').data('favorite-id');
            await handleEditNote(favoriteId);
        });
        
        // 绑定备注区域点击事件
        itemElement.find('.favorite-note').on('click', function() {
            const favoriteId = $(this).closest('.favorite-item').data('favorite-id');
            handleEditNote(favoriteId);
        });
        
        favoritesContainer.append(itemElement);
    });
    
    // 添加清理按钮
    const cleanupButton = $(`
        <div class="favorites-cleanup">
            <button id="cleanup_favorites_button">
                <i class="fa-solid fa-broom"></i> 清理无效收藏
            </button>
        </div>
    `);
    
    popupContent.append(cleanupButton);
    
    // 绑定清理按钮点击事件
    $('#cleanup_favorites_button').on('click', async function() {
        await handleClearInvalidFavorites();
    });
}

// 显示收藏弹窗
function showFavoritesPopup() {
    ensureFavoritesArrayExists();
    
    // 检查弹窗是否已存在
    let favoritesPopup = $('#favorites_popup');
    
    if (favoritesPopup.length === 0) {
        // 创建弹窗HTML
        const popupHtml = `
            <div id="favorites_popup" class="favorites-popup">
                <div class="favorites-popup-header">
                    <div class="favorites-popup-title">收藏消息</div>
                    <div class="favorites-popup-close"><i class="fa-solid fa-times"></i></div>
                </div>
                <div id="favorites_popup_content" class="favorites-popup-content">
                    <!-- 内容将通过JS填充 -->
                </div>
            </div>
        `;
        
        // 添加到页面
        $('body').append(popupHtml);
        favoritesPopup = $('#favorites_popup');
        
        // 绑定关闭按钮事件
        $('.favorites-popup-close').on('click', function() {
            favoritesPopup.hide();
        });
        
        // 点击弹窗外部也关闭
        $(document).on('click', function(event) {
            if (
                favoritesPopup.is(':visible') && 
                !$(event.target).closest('#favorites_popup').length && 
                !$(event.target).closest('#favorites_button').length
            ) {
                favoritesPopup.hide();
            }
        });
    }
    
    // 更新弹窗内容
    updateFavoritesPopup();
    
    // 显示弹窗
    favoritesPopup.show();
}

// 从弹窗中删除收藏
async function handleDeleteFavoriteFromPopup(favId, messageId) {
    const success = removeFavoriteById(favId);
    
    if (success) {
        toastr.info('已删除收藏');
        
        // 更新弹窗
        updateFavoritesPopup();
        
        // 更新对应消息的收藏图标
        const messageElement = $(`.mes[mesid="${messageId}"]`);
        if (messageElement.length > 0) {
            messageElement.find('.favorite-button').removeClass('favorite-marked');
        }
    } else {
        toastr.error('删除收藏失败');
    }
}

// 编辑收藏备注
async function handleEditNote(favId) {
    const chatId = ensureFavoritesArrayExists();
    const favItem = extension_settings[pluginName].chats[chatId].items.find(
        item => item.id === favId
    );
    
    if (!favItem) {
        toastr.error('找不到该收藏');
        return;
    }
    
    const newNote = await callPopup('输入备注:', 'input', favItem.note || '');
    
    if (newNote !== false) {
        updateFavoriteNote(favId, newNote);
        updateFavoritesPopup();
    }
}

// 清理无效收藏
async function handleClearInvalidFavorites() {
    const chatId = ensureFavoritesArrayExists();
    const favItems = extension_settings[pluginName].chats[chatId].items;
    
    const originalLength = favItems.length;
    
    // 获取完整消息列表
    const context = getContext();
    const chat = context.chat;
    
    // 过滤出无效的收藏（找不到原始消息的）
    const validItems = favItems.filter(favItem => {
        return chat.some(msg => String(msg.id || msg.index) === String(favItem.messageId));
    });
    
    // 如果有无效收藏，则移除它们
    if (validItems.length < originalLength) {
        extension_settings[pluginName].chats[chatId].items = validItems;
        savePluginSettings();
        
        const removedCount = originalLength - validItems.length;
        toastr.success(`已清理 ${removedCount} 条无效收藏`);
        
        // 更新弹窗
        updateFavoritesPopup();
        // 刷新图标显示
        refreshFavoriteIconsInView();
    } else {
        toastr.info('没有发现无效收藏');
    }
}

// 初始化插件
jQuery(async () => {
    // 确保CSS样式已添加
    const favoriteCSS = `
        .favorite-button {
            cursor: pointer;
            color: #808080;
            transition: color 0.2s;
        }
        .favorite-button:hover {
            color: #ffd700;
        }
        .favorite-button.favorite-marked {
            color: #ffd700;
        }
        
        /* 收藏弹窗样式 */
        .favorites-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 80%;
            max-width: 600px;
            max-height: 80vh;
            background-color: var(--SmartThemeShadowColor);
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 10px;
            z-index: 1000;
            display: none;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
        }
        .favorites-popup-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 15px;
            border-bottom: 1px solid var(--SmartThemeBorderColor);
        }
        .favorites-popup-title {
            font-size: 18px;
            font-weight: bold;
        }
        .favorites-popup-close {
            cursor: pointer;
            font-size: 18px;
        }
        .favorites-popup-content {
            padding: 15px;
            overflow-y: auto;
            max-height: calc(80vh - 60px);
        }
        .favorites-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .favorite-item {
            background-color: var(--SmartThemeBlurTintColor);
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 8px;
            padding: 10px;
        }
        .favorite-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
        }
        .favorite-character {
            font-weight: bold;
        }
        .favorite-number {
            color: #808080;
        }
        .favorite-content {
            margin-bottom: 8px;
        }
        .favorite-note {
            font-style: italic;
            padding: 5px;
            border-radius: 4px;
            background-color: rgba(255, 255, 255, 0.05);
            margin-bottom: 8px;
            cursor: pointer;
        }
        .favorite-note.empty-note {
            color: #808080;
        }
        .favorite-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }
        .favorite-actions button {
            background: none;
            border: none;
            cursor: pointer;
            padding: 5px;
            border-radius: 4px;
            color: #808080;
            transition: color 0.2s, background-color 0.2s;
        }
        .favorite-actions button:hover {
            color: white;
            background-color: rgba(255, 255, 255, 0.1);
        }
        .favorite-edit-note:hover {
            color: #4caf50 !important;
        }
        .favorite-delete:hover {
            color: #f44336 !important;
        }
        .no-favorites {
            text-align: center;
            padding: 20px;
            color: #808080;
        }
        .favorites-cleanup {
            text-align: center;
            margin-top: 15px;
        }
        .favorites-cleanup button {
            background: none;
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 4px;
            padding: 5px 10px;
            cursor: pointer;
            color: #808080;
            transition: color 0.2s, background-color 0.2s;
        }
        .favorites-cleanup button:hover {
            background-color: rgba(255, 255, 255, 0.1);
            color: white;
        }
        .favorites-preview-button {
            text-align: right;
            margin-bottom: 10px;
        }
        .favorites-preview-button button {
            background: none;
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 4px;
            padding: 5px 10px;
            cursor: pointer;
            color: #1e88e5;
            transition: color 0.2s, background-color 0.2s;
        }
        .favorites-preview-button button:hover {
            background-color: rgba(30, 136, 229, 0.1);
        }
    `;
    
    // 添加CSS样式
    if (!$('#favorites_plugin_style').length) {
        $('head').append(`<style id="favorites_plugin_style">${favoriteCSS}</style>`);
    }
    
    // 加载收藏按钮到输入框右侧
    try {
        const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
        $('#data_bank_wand_container').append(inputButtonHtml);
        
        // 绑定点击事件
        $('#favorites_button').on('click', function() {
            showFavoritesPopup();
        });
        
        console.log(`[${pluginName}] 已添加收藏按钮到输入框右侧`);
    } catch (error) {
        console.error(`[${pluginName}] 加载按钮模板失败:`, error);
    }
    
    // 加载设置界面
    try {
        const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
        $('#extensions_settings').append(settingsHtml);
        console.log(`[${pluginName}] 已添加设置界面到扩展页面`);
    } catch (error) {
        console.error(`[${pluginName}] 加载设置模板失败:`, error);
    }
    
    // 初始化收藏数据
    ensureFavoritesArrayExists();
    
    // 绑定消息收藏图标的点击事件委托
    $(document).on('click', '.favorite-button', handleFavoriteToggle);
    
    // 初始化时添加收藏图标到现有消息
    addFavoriteIconsToMessages();
    
    // 监听新消息事件，为新消息添加收藏图标
    const handleNewMessage = () => {
        addFavoriteIconsToMessages();
    };
    
    // 绑定相关事件
    eventSource.on('message_sent', handleNewMessage);
    eventSource.on('message_received', handleNewMessage);
    eventSource.on('message_edited', handleNewMessage);
    eventSource.on('chat_changed', () => {
        // 聊天切换时刷新图标
        setTimeout(() => {
            addFavoriteIconsToMessages();
            refreshFavoriteIconsInView();
        }, 500);
    });
    
    console.log(`[${pluginName}] 插件初始化完成!`);
});
