let db;

// Global Variables
let currentShopID = localStorage.getItem('smartpos_shop_id') || null; 
let shopName = "My Shop"; 
let waNumber = "";
let customersDB = []; let productsDB = []; let salesHistoryDB = [];
let dueCollectionHistoryDB = []; let expensesDB = [];
let holdInvoices = []; let cartItems = [];
let currentCustomerDue = 0; let cartTotal = 0;
let currentCostTab = 'daily'; let salesChart; let advAnalyticsChart;
let activeLedgerCus = ""; 

// 🔥 INSTANT UI LOAD (০ সেকেন্ডে ড্যাশবোর্ড লোড করার ম্যাজিক)
document.addEventListener("DOMContentLoaded", () => {
    if (currentShopID && currentShopID !== "null") {
        // লগইন করা থাকলে সাথে সাথেই লগইন পেজ ও লোডার গায়েব করে ড্যাশবোর্ড দেখাবে
        let landing = document.getElementById('saas-landing');
        let skeleton = document.getElementById('skeleton-loader');
        if(landing) landing.style.display = 'none';
        if(skeleton) skeleton.style.display = 'none';
        
        document.querySelector('.pos-container').style.display = 'flex';
        
        // ফায়ারবেসের জন্য অপেক্ষা না করে লোকাল স্টোরেজ থেকে ডাটা দেখিয়ে দিবে
        loadLocalData(currentShopID);
        finalizeUIRender();
    } else {
        // লগইন করা না থাকলে সাথে সাথেই লগইন পেজ দেখাবে
        let skeleton = document.getElementById('skeleton-loader');
        if(skeleton) skeleton.style.display = 'none';
        let landing = document.getElementById('saas-landing');
        if(landing) landing.style.display = 'flex';
    }
});

// ================= FIREBASE INIT (ব্যাকগ্রাউন্ডে চলবে) =================
window.onload = function() {
    const firebaseConfig = {
        apiKey: "AIzaSyBgMVRoxVXLJCiRny-YQj0Ug-z4g6gt4fQ",
        authDomain: "poss-daad9.firebaseapp.com",
        projectId: "poss-daad9",
        storageBucket: "poss-daad9.firebasestorage.app",
        messagingSenderId: "1056012130294",
        appId: "1:1056012130294:web:351d75ee2b8c9e1f9419d7"
    };

    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
        db = firebase.firestore();
        db.enablePersistence().catch(err => { console.log("Persistence failed: ", err); });
        
        // ব্যাকগ্রাউন্ডে চেক করবে লাইসেন্স ঠিক আছে কি না
        initializeApp();
    } else {
        console.log("Firebase loaded offline.");
    }
};

// ================= INITIALIZATION =================
function initializeApp() {
    currentShopID = localStorage.getItem('smartpos_shop_id');
    if (currentShopID && currentShopID !== "null") {
        checkSubscription(); // ব্যাকগ্রাউন্ডে লাইসেন্স ও সিঙ্ক চেক করবে
    }
    updateTime(); setInterval(updateTime, 1000); 
    checkNetworkStatus(); 
    window.addEventListener('online', checkNetworkStatus); 
    window.addEventListener('offline', checkNetworkStatus);
    setTimeout(listenToGlobalNotice, 2000); 
    setTimeout(listenToMaintenanceMode, 3000);
    setTimeout(listenForSupportReplies, 5000);
}

function showLoginPage() {
    let skeleton = document.getElementById('skeleton-loader');
    if(skeleton) skeleton.style.display = 'none';

    document.querySelector('.pos-container').style.display = 'none';
    let landing = document.getElementById('saas-landing');
    if(landing) { landing.classList.remove('hidden'); landing.style.display = 'flex'; }
}

function showDashboard() {
    let skeleton = document.getElementById('skeleton-loader');
    if(skeleton) skeleton.style.display = 'none';

    let landing = document.getElementById('saas-landing');
    if(landing) landing.style.display = 'none';
    document.querySelector('.pos-container').style.display = 'flex';
    finalizeUIRender();
}

// ================= AUTHENTICATION & SYNC =================
function checkSubscription() {
    currentShopID = localStorage.getItem('smartpos_shop_id');
    let adminPass = localStorage.getItem('smartpos_admin_pass') || "ADMIN-PRO-MAX";
    if (currentShopID === adminPass.toUpperCase() || localStorage.getItem('is_super_admin') === 'true') {
        loadDataAndSync(currentShopID); return;
    }

    let isTrial = currentShopID.startsWith("TRIAL-");
    let now = new Date().getTime();

    if (isTrial) {
        let trialStart = localStorage.getItem('smartpos_trial_start');
        if(!trialStart) trialStart = now;
        let daysUsed = Math.floor((now - parseInt(trialStart)) / (1000 * 60 * 60 * 24));
        if (daysUsed <= 15) { 
            loadDataAndSync(currentShopID); 
        } else { 
            alert("আপনার ১৫ দিনের ফ্রি ট্রায়াল শেষ হয়ে গেছে! দয়া করে লাইসেন্স কিনুন।"); 
            forceLogout(); 
        }
    } else {
        loadDataAndSync(currentShopID); 
        
        if(db) {
            db.collection('licenses').doc(currentShopID).get().then(doc => {
                if(doc.exists) {
                    if(doc.data().isActive === false) {
                        alert("❌ আপনার লাইসেন্সটি সাসপেন্ড করা হয়েছে!"); 
                        forceLogout();
                    } else {
                        let days = doc.data().validityDays || 30;
                        localStorage.setItem('smartpos_expiry', now + (days * 24 * 60 * 60 * 1000));
                    }
                } else {
                    alert("❌ আপনার লাইসেন্সটি ডাটাবেসে পাওয়া যায়নি!"); 
                    forceLogout();
                }
            }).catch(err => {
                let expiryStr = localStorage.getItem('smartpos_expiry');
                if(expiryStr && now > parseInt(expiryStr)) {
                    alert("❌ আপনার সফটওয়্যার লাইসেন্সের মেয়াদ শেষ হয়ে গেছে!"); 
                    forceLogout();
                }
            });
        }
    }
}

function loadDataAndSync(shopId) {
    if(!shopId) return;
    
    // ব্যাকগ্রাউন্ডে ফায়ারবেস চেক করবে
    if (!db) return;
    db.collection('shops').doc(shopId).get().then((doc) => {
        if (doc.exists) { 
            let data = doc.data(); 
            
            const fixDates = (arr) => {
                if(!arr) return [];
                return arr.map(item => {
                    if (item.rawDate && item.rawDate.seconds) item.rawDate = item.rawDate.seconds * 1000;
                    return item;
                });
            };
            
            if(data.customers && data.customers.length >= customersDB.length) customersDB = data.customers; 
            if(data.products && data.products.length >= productsDB.length) productsDB = data.products; 
            if(data.sales && data.sales.length >= salesHistoryDB.length) salesHistoryDB = fixDates(data.sales); 
            if(data.due_collections && data.due_collections.length >= dueCollectionHistoryDB.length) dueCollectionHistoryDB = fixDates(data.due_collections); 
            if(data.expenses && data.expenses.length >= expensesDB.length) expensesDB = fixDates(data.expenses); 
            
            shopName = data.shopName || "My Shop"; waNumber = data.waNumber || "";
            localStorage.setItem(`pos_${shopId}_shopname`, shopName);
            localStorage.setItem(`pos_${shopId}_wanumber`, waNumber);
            localStorage.setItem(`pos_${shopId}_user_name`, data.ownerName || "");
            localStorage.setItem(`pos_${shopId}_user_email`, data.email || "");
            
            if(data.profilePic && data.profilePic.startsWith('data:image')) { localStorage.setItem(`pos_${shopId}_user_pic`, data.profilePic); } 
            else { localStorage.removeItem(`pos_${shopId}_user_pic`); }
            
            saveDataLocally(shopId); 
            applyShopBranding(); renderAllTables(); populateDropdowns(); renderSalesHistory(); updateCostUI(); switchDashboardView('daily'); 
        }
    });
}

function loadLocalData(shopId) {
    try {
        let c = localStorage.getItem(`pos_${shopId}_customers`); if(c) customersDB = JSON.parse(c);
        let p = localStorage.getItem(`pos_${shopId}_products`); if(p) productsDB = JSON.parse(p);
        let s = localStorage.getItem(`pos_${shopId}_sales`); if(s) salesHistoryDB = JSON.parse(s);
        let d = localStorage.getItem(`pos_${shopId}_due_collections`); if(d) dueCollectionHistoryDB = JSON.parse(d);
        let e = localStorage.getItem(`pos_${shopId}_expenses`); if(e) expensesDB = JSON.parse(e);
        shopName = localStorage.getItem(`pos_${shopId}_shopname`) || "My Shop";
        waNumber = localStorage.getItem(`pos_${shopId}_wanumber`) || "";
    } catch(e) { console.error("Local Data Error"); }
}

function saveData() {
    if(!currentShopID) return;
    saveDataLocally(currentShopID);
    if (!currentShopID.startsWith("TRIAL-")) {
        db.collection('shops').doc(currentShopID).set({
            customers: customersDB, products: productsDB, sales: salesHistoryDB, due_collections: dueCollectionHistoryDB, expenses: expensesDB,
            shopName: shopName, waNumber: waNumber, lastSync: new Date().toLocaleString()
        }, { merge: true }).catch(e => console.log("Cloud save delayed (Offline)"));
    }
}

function saveDataLocally(shopId) {
    try {
        localStorage.setItem(`pos_${shopId}_customers`, JSON.stringify(customersDB));
        localStorage.setItem(`pos_${shopId}_products`, JSON.stringify(productsDB));
        localStorage.setItem(`pos_${shopId}_sales`, JSON.stringify(salesHistoryDB));
        localStorage.setItem(`pos_${shopId}_due_collections`, JSON.stringify(dueCollectionHistoryDB));
        localStorage.setItem(`pos_${shopId}_expenses`, JSON.stringify(expensesDB));
    } catch (e) { if (e.name === 'QuotaExceededError') alert("মেমোরি ফুল! কিছু ছবি ডিলিট করুন।"); }
}

function finalizeUIRender() {
    applyShopBranding(); applyGlobalBranding(); renderAllTables(); populateDropdowns(); renderSalesHistory(); updateCostUI(); initChart(); switchDashboardView('daily'); 
    if (!document.querySelector('.page-section.active')) { switchPage('dashboard'); }
    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active')) { loadUserProfileData(); }
}

// ================= LOGIN / LOGOUT =================
function guestLogin() {
    let phone = prompt("১৫ দিনের ফ্রি ট্রায়াল শুরু করতে আপনার মোবাইল নাম্বারটি দিন (ex: 017...):");
    if(!phone || phone.trim().length < 11) { alert("❌ সঠিক মোবাইল নাম্বার দেওয়া আবশ্যক!"); return; }
    let trialStart = new Date().getTime(); let shopID = "TRIAL-" + trialStart;
    localStorage.setItem('smartpos_trial_start', trialStart); localStorage.setItem('smartpos_shop_id', shopID);
    currentShopID = shopID; shopName = "Guest Shop"; waNumber = phone.trim();
    localStorage.setItem(`pos_${shopID}_shopname`, shopName); localStorage.setItem(`pos_${shopID}_wanumber`, waNumber);
    alert("✅ আপনার ১৫ দিনের ফ্রি ট্রায়াল শুরু হয়েছে!"); checkSubscription();
    if(db) { db.collection('shops').doc(shopID).set({ shopName: "Guest Shop", waNumber: phone.trim(), isTrial: true, createdAt: new Date().toLocaleString() }, { merge: true }); }
}

function activateLicense() {
    let inputKey = document.getElementById('license-key-input').value.toUpperCase().trim();
    if (!inputKey) return alert("❌ দয়া করে লাইসেন্স কী (License Key) দিন!");
    let currentPass = localStorage.getItem('smartpos_admin_pass') || "ADMIN-PRO-MAX";
    if(inputKey === currentPass.toUpperCase()) return openAdminPanel();
    if (!db) return alert("❌ ফায়ারবেস কানেক্ট হয়নি! ইন্টারনেট চেক করুন।");
    let btn = document.querySelector("button[onclick='activateLicense()']");
    if(btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...'; btn.disabled = true; }

    db.collection('licenses').doc(inputKey).get().then((doc) => {
        if(btn) { btn.innerHTML = 'Activate License'; btn.disabled = false; }
        if(doc.exists && doc.data().isActive) {
            let validityDays = doc.data().validityDays || 30; currentShopID = inputKey; 
            localStorage.setItem('smartpos_shop_id', currentShopID);
            localStorage.setItem('smartpos_expiry', new Date().getTime() + (validityDays * 24 * 60 * 60 * 1000));
            alert("Activation Successful! 🎉"); 
            document.getElementById('saas-landing').style.display = 'none';
            loadDataAndSync(currentShopID); 
        } else alert("❌ Invalid or Blocked License Key!");
    }).catch((error) => {
        if(btn) { btn.innerHTML = 'Activate License'; btn.disabled = false; }
        alert("⚠️ Database Error: " + error.message);
    });
}

function logoutSystem() {
    if(confirm("আপনি কি নিশ্চিত যে লগআউট করতে চান?")) {
        localStorage.removeItem('smartpos_shop_id'); localStorage.removeItem('is_super_admin'); currentShopID = null;
        customersDB = []; productsDB = []; salesHistoryDB = []; dueCollectionHistoryDB = []; expensesDB = []; cartItems = []; shopName = "My Shop"; waNumber = "";
        showLoginPage(); let licenseInput = document.getElementById('license-key-input'); if(licenseInput) licenseInput.value = '';
        alert("✅ সফলভাবে লগআউট হয়েছে!");
    }
}

function forceLogout() { localStorage.removeItem('smartpos_shop_id'); currentShopID = null; showLoginPage(); }
function changeAdminPassword() {
    let currentPass = localStorage.getItem('smartpos_admin_pass') || "ADMIN-PRO-MAX";
    let oldPass = prompt("🔒 আপনার বর্তমান (Current) পাসওয়ার্ডটি দিন:");
    if (oldPass === currentPass) { let newPass = prompt("🔑 নতুন (New) পাসওয়ার্ডটি লিখুন:");
        if (newPass && newPass.trim() !== "") { localStorage.setItem('smartpos_admin_pass', newPass.trim()); alert("✅ পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে!"); } 
        else { alert("❌ পাসওয়ার্ড খালি রাখা যাবে!"); }
    } else if (oldPass !== null) { alert("❌ বর্তমান পাসওয়ার্ডটি ভুল গঠন!"); }
}

// ================= ADMIN FUNCTIONS =================
function checkAdminAccess() {
    let pass = prompt("🔒 Enter Master Admin Password:"); let currentPass = localStorage.getItem('smartpos_admin_pass') || "ADMIN-PRO-MAX";
    if (pass === currentPass) {
        let skeleton = document.getElementById('skeleton-loader'); if(skeleton) skeleton.style.display = 'none';

        localStorage.setItem('is_super_admin', 'true'); document.querySelector('.pos-container').style.display = 'none';
        let adminPanel = document.getElementById('super-admin-panel'); if(adminPanel) { adminPanel.classList.remove('hidden'); adminPanel.style.display = 'block'; }
        loadMasterDatabase(); loadPlans(); loadAdminStats(); loadGlobalSettings(); loadSupportTickets(); if(typeof loadMaintenanceStatus === 'function') loadMaintenanceStatus(); 
        alert("Welcome Boss! 🚀");
    } else if (pass) { alert("❌ Wrong Password!"); }
}

function openAdminPanel() {
    let skeleton = document.getElementById('skeleton-loader'); if(skeleton) skeleton.style.display = 'none';

    localStorage.setItem('is_super_admin', 'true'); document.getElementById('saas-landing').style.display = 'none';
    let adminPanel = document.getElementById('super-admin-panel'); if(adminPanel) { adminPanel.classList.remove('hidden'); adminPanel.style.display = 'block'; }
    loadMasterDatabase(); loadPlans(); loadAdminStats(); loadGlobalSettings(); loadSupportTickets(); if(typeof loadMaintenanceStatus === 'function') loadMaintenanceStatus();
}

function logoutAdmin() {
    localStorage.removeItem('is_super_admin'); let adminPanel = document.getElementById('super-admin-panel'); if(adminPanel) { adminPanel.classList.add('hidden'); adminPanel.style.display = 'none'; }
    document.querySelector('.pos-container').style.display = 'flex'; checkSubscription();
}

function generateLicense() {
    let shopId = document.getElementById('new-shop-id').value.toUpperCase().trim(); let validity = parseInt(document.getElementById('custom-days') ? document.getElementById('custom-days').value : 30);
    if(!shopId) return alert("দয়া করে দোকানের নাম বা ফোন নাম্বার দিন!"); if(!validity || validity <= 0) return alert("দয়া করে কত দিনের মেয়াদ হবে তা লিখুন!");
    db.collection('licenses').doc(shopId).set({ shopID: shopId, validityDays: validity, isActive: true, createdAt: new Date().toLocaleString() }).then(() => { 
        alert(`Success! 🎉 ${shopId} এর জন্য ${validity} দিনের লাইসেন্স তৈরি হয়েছে।`); loadMasterDatabase(); loadAdminStats();
        if(document.getElementById('new-shop-id')) document.getElementById('new-shop-id').value=''; if(document.getElementById('custom-days')) document.getElementById('custom-days').value='';
    });
}

function extendLicense(shopID) {
    let extraDays = parseInt(prompt(`আপনি ${shopID} এর মেয়াদ আরও কত দিন বাড়াতে চান?`)); if(!extraDays || extraDays <= 0) return;
    db.collection('licenses').doc(shopID).get().then(doc => {
        if(doc.exists) { let currentDays = doc.data().validityDays || 0; db.collection('licenses').doc(shopID).set({ validityDays: currentDays + extraDays, isActive: true }, { merge: true }).then(() => { alert(`✅ ${shopID} এর মেয়াদ আরও ${extraDays} দিন বাড়ানো হয়েছে।`); loadMasterDatabase(); }); } 
        else alert("❌ এই আইডি দিয়ে আগে কোনো প্রো লাইসেন্স তৈরি করা হয়নি!");
    });
}

function resetShopPassword(shopID) { if(confirm(`আপনি কি নিশ্চিত যে ${shopID} এর পাসওয়ার্ড রিসেট করে ডিফল্ট "1234" করতে চান?`)) { db.collection('shops').doc(shopID).set({ password: "1234" }, { merge: true }).then(() => { alert(`✅ ${shopID} এর পাসওয়ার্ড সফলভাবে রিসেট করে "1234" সেট করা হয়েছে!`); }); } }

function loadMasterDatabase() {
    const tbody = document.getElementById('master-shop-list'); if(!tbody) return; tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading Shop Data...</td></tr>';
    db.collection('shops').get().then((querySnapshot) => {
        tbody.innerHTML = '';
        querySnapshot.forEach((doc) => {
            let data = doc.data(); let shopID = doc.id; let shopSales = 0; if(data.sales) data.sales.forEach(s => shopSales += s.total);
            db.collection('licenses').doc(shopID).get().then(licDoc => {
                let statusTag = ""; let suspendBtn = ""; let extendBtn = ""; let resetBtn = ""; let isActive = true;
                if (licDoc.exists) {
                    isActive = licDoc.data().isActive; let days = licDoc.data().validityDays || 0; 
                    if(isActive) { statusTag = `<span style="background:#dcfce7; color:#166534; padding:3px 8px; border-radius:12px; font-size:11px;">🟢 Pro (${days}d)</span>`; suspendBtn = `<button class="btn btn-warning btn-small" onclick="toggleShopStatus('${shopID}', false)"><i class="fa-solid fa-lock"></i></button>`; } 
                    else { statusTag = `<span style="background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:12px; font-size:11px;">🔴 Suspended</span>`; suspendBtn = `<button class="btn btn-success btn-small" onclick="toggleShopStatus('${shopID}', true)"><i class="fa-solid fa-unlock"></i></button>`; }
                    extendBtn = `<button class="btn btn-small" style="background:#0ea5e9; color:white; border:none;" onclick="extendLicense('${shopID}')"><i class="fa-solid fa-plus"></i></button>`;
                } else {
                    statusTag = `<span style="background:#fef08a; color:#854d0e; padding:3px 8px; border-radius:12px; font-size:11px;">⏳ Trial Mode</span>`; suspendBtn = `<button class="btn btn-warning btn-small" onclick="toggleShopStatus('${shopID}', false)"><i class="fa-solid fa-lock"></i></button>`;
                }
                resetBtn = `<button class="btn btn-small" style="background:#8b5cf6; color:white; border:none;" onclick="resetShopPassword('${shopID}')"><i class="fa-solid fa-key"></i></button>`;
                tbody.innerHTML += `<tr style="border-bottom: 1px solid #e2e8f0; background: ${isActive ? 'transparent' : '#fff1f2'};"><td style="padding:10px;"><b>${data.shopName||shopID}</b><br><small style="color:#64748b;">ID: ${shopID}</small></td><td style="padding:10px; color:#3b82f6; font-weight:bold;">${data.waNumber||'N/A'}</td><td style="padding:10px;">${statusTag}</td><td style="padding:10px; color:#10b981; font-weight:bold;">৳ ${shopSales.toFixed(0)}</td><td style="padding:10px; display:flex; gap:5px;">${extendBtn} ${resetBtn} ${suspendBtn} <button class="btn btn-primary btn-small" onclick="peekIntoShop('${shopID}')"><i class="fa-solid fa-eye"></i></button> <button class="btn btn-danger btn-small" onclick="deleteShop('${shopID}')"><i class="fa-solid fa-trash"></i></button></td></tr>`;
            });
        });
    });
}

function toggleShopStatus(shopID, makeActive) { let actionTxt = makeActive ? "আনলক (Unlock)" : "লক (Suspend)"; if(confirm(`আপনি কি এই দোকানটি ${actionTxt} করতে চান?`)) { db.collection('licenses').doc(shopID).set({ isActive: makeActive }, { merge: true }).then(() => { alert(`সফলভাবে ${actionTxt} করা হয়েছে!`); loadMasterDatabase(); loadAdminStats(); }); } }
function peekIntoShop(shopID) { currentShopID = shopID; let adminPanel = document.getElementById('super-admin-panel'); if(adminPanel) { adminPanel.classList.add('hidden'); adminPanel.style.display = 'none'; } loadDataAndSync(shopID); }
function deleteShop(shopID) { if(confirm("Wipe all data for this shop?")) db.collection('shops').doc(shopID).delete().then(() => { loadMasterDatabase(); loadAdminStats(); }); }

function loadAdminStats() {
    let totalShops = 0; let proShops = 0;
    db.collection('shops').get().then(snap => {
        totalShops = snap.size;
        db.collection('licenses').where('isActive', '==', true).get().then(licSnap => {
            proShops = licSnap.size; let trialShops = totalShops - proShops;
            let elTotal = document.getElementById('admin-stat-total'); let elPro = document.getElementById('admin-stat-pro'); let elTrial = document.getElementById('admin-stat-trial');
            if(elTotal) elTotal.innerText = totalShops; if(elPro) elPro.innerText = proShops; if(elTrial) elTrial.innerText = trialShops < 0 ? 0 : trialShops;
        });
    });
}

function cleanDeadShops() {
    if(!confirm("⚠️ ওয়ার্নিং! ডেড দোকান মুছে ফেলা হবে!")) return;
    let deadCount = 0;
    db.collection('shops').get().then(snap => {
        snap.forEach(doc => { let shopID = doc.id; db.collection('licenses').doc(shopID).get().then(licDoc => { if(!licDoc.exists || licDoc.data().isActive === false) { db.collection('shops').doc(shopID).delete(); deadCount++; } }); });
        setTimeout(() => { alert(`🧹 ${deadCount} টি ডেড দোকান মুছে ফেলা হয়েছে।`); loadMasterDatabase(); loadAdminStats(); }, 2000);
    });
}

function saveGlobalAppName() { let appName = document.getElementById('global-app-name-input').value.trim(); if(!appName) return alert("দয়া করে App Name লিখুন!"); db.collection('system').doc('config').set({ appName: appName }, { merge: true }).then(() => { alert("✅ App Name সফলভাবে আপডেট হয়েছে!"); }); }
function updateGlobalSettings() { let isTrialAllowed = document.getElementById('global-trial-toggle').checked; db.collection('system').doc('config').set({ allowTrial: isTrialAllowed }, { merge: true }).then(() => { alert(isTrialAllowed ? "✅ ফ্রি ট্রায়াল চালু হয়েছে!" : "❌ ফ্রি ট্রায়াল বন্ধ করা হয়েছে!"); }); }
function sendGlobalNotice() { let txt = document.getElementById('global-notice-input').value.trim(); if(!txt) return alert("নোটিশ লিখুন!"); db.collection('system').doc('config').set({ globalNotice: txt, noticeTime: new Date().getTime() }, { merge: true }).then(() => alert("📢 নোটিশ পাঠানো হয়েছে!")); }
function clearGlobalNotice() { db.collection('system').doc('config').set({ globalNotice: "" }, { merge: true }).then(() => { document.getElementById('global-notice-input').value = ''; alert("🗑️ নোটিশ মুছে ফেলা হয়েছে!"); }); }
function loadGlobalSettings() { db.collection('system').doc('config').get().then(doc => { if(doc.exists) { let d = doc.data(); let toggleBtn = document.getElementById('global-trial-toggle'); if(toggleBtn) toggleBtn.checked = d.allowTrial !== false; let noticeInput = document.getElementById('global-notice-input'); if(noticeInput) noticeInput.value = d.globalNotice || ""; let appNameInput = document.getElementById('global-app-name-input'); if(appNameInput) appNameInput.value = d.appName || "SmartPOS Pro"; } }); }

function listenToGlobalNotice() {
    if(!db) return;
    db.collection('system').doc('config').onSnapshot((doc) => {
        if(doc.exists) {
            let d = doc.data(); localStorage.setItem('smartpos_trial_allowed', d.allowTrial !== false);
            if(d.appName) localStorage.setItem('smartpos_app_name', d.appName);
            if(d.globalLogo) localStorage.setItem('smartpos_global_logo', d.globalLogo);
            applyGlobalBranding();
            let noticeBoard = document.getElementById('client-notice-board'); let noticeStyleFix = document.getElementById('notice-dynamic-style');
            if(!noticeStyleFix) { noticeStyleFix = document.createElement('style'); noticeStyleFix.id = 'notice-dynamic-style'; document.head.appendChild(noticeStyleFix); }
            if(d.globalNotice && d.globalNotice !== "") {
                if(!noticeBoard) { noticeBoard = document.createElement('div'); noticeBoard.id = 'client-notice-board'; noticeBoard.style = "background: #f59e0b; color: #fff; padding: 6px; text-align: center; font-size: 14px; font-weight: bold; position: fixed; top: 0; left: 0; width: 100%; z-index: 999999; box-shadow: 0 2px 5px rgba(0,0,0,0.2);"; document.body.prepend(noticeBoard); }
                noticeBoard.innerHTML = `<marquee direction="left" scrollamount="5"><i class="fa-solid fa-bullhorn"></i> <b>Admin Notice:</b> ${d.globalNotice}</marquee>`; noticeBoard.style.display = 'block';
            } else { if(noticeBoard) noticeBoard.style.display = 'none'; noticeStyleFix.innerHTML = ``; }
        }
    });
}

function toggleMaintenanceMode() { let status = document.getElementById('maintenance-toggle').checked; db.collection('system').doc('maintenance').set({ isActive: status, message: "সিস্টেমে জরুরি আপডেট চলছে। সাময়িক অসুবিধার জন্য আমরা দুঃখিত!", startTime: new Date().getTime() }, { merge: true }).then(() => alert(status ? "🛑 Maintenance Mode চালু হয়েছে!" : "✅ সিস্টেম এখন লাইভ!")); }
function loadMaintenanceStatus() { db.collection('system').doc('maintenance').get().then(doc => { if(doc.exists) { let toggleBtn = document.getElementById('maintenance-toggle'); if(toggleBtn) toggleBtn.checked = doc.data().isActive; } }); }

function listenToMaintenanceMode() {
    if(!db) return;
    db.collection('system').doc('maintenance').onSnapshot((doc) => {
        if(doc.exists) {
            let d = doc.data(); let lockScreen = document.getElementById('maintenance-screen');
            let adminPanel = document.getElementById('super-admin-panel'); let isInsideAdmin = (adminPanel && adminPanel.style.display === 'block');
            let adminPass = localStorage.getItem('smartpos_admin_pass') || "ADMIN-PRO-MAX"; let isMasterAdmin = (currentShopID === adminPass.toUpperCase() || currentShopID === "ADMIN-PRO-MAX" || localStorage.getItem('is_super_admin') === 'true');
            if(d.isActive && !isMasterAdmin && !isInsideAdmin) {
                if(!lockScreen) { lockScreen = document.createElement('div'); lockScreen.id = 'maintenance-screen'; lockScreen.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:#0f172a; color:white; z-index:999999; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:20px;"; lockScreen.innerHTML = `<i class="fa-solid fa-screwdriver-wrench" style="font-size:80px; color:#facc15; margin-bottom:20px;"></i><h2>Under Maintenance!</h2><p>${d.message}</p>`; document.body.appendChild(lockScreen); }
                lockScreen.style.display = 'flex'; document.body.style.overflow = 'hidden';
            } else { if(lockScreen) { lockScreen.style.display = 'none'; document.body.style.overflow = 'auto'; } }
        }
    });
}

function sendSupportTicket() { 
    if(!currentShopID) return alert("❌ Please login first!"); 
    let issue = prompt("অ্যাডমিনকে আপনার সমস্যা বিস্তারিত লিখুন:"); if(!issue || issue.trim() === "") return; 
    let supportBtn = event.currentTarget; let originalText = supportBtn.innerHTML; supportBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...'; supportBtn.disabled = true;
    db.collection('support_tickets').add({ shopID: currentShopID, shopName: shopName || "Unknown Shop", message: issue.trim(), reply: "", status: "Open", timestamp: new Date().getTime(), dateStr: new Date().toLocaleString() }).then(() => { supportBtn.innerHTML = originalText; supportBtn.disabled = false; alert("✅ মেসেজ সফলভাবে অ্যাডমিনের কাছে পাঠানো হয়েছে! অ্যাডমিন রিপ্লাই দিলে আপনি নোটিফিকেশন পাবেন।"); }).catch(err => { supportBtn.innerHTML = originalText; supportBtn.disabled = false; alert("❌ Error: মেসেজ পাঠানো যায়নি। ইন্টারনেট চেক করুন।"); }); 
}

function listenForSupportReplies() { if(!db) return; if(!currentShopID || currentShopID.startsWith("TRIAL-")) return; db.collection('support_tickets').where('shopID', '==', currentShopID).where('status', '==', 'Closed').onSnapshot(snap => { snap.docChanges().forEach(change => { if (change.type === "added" || change.type === "modified") { let data = change.doc.data(); if(data.reply && data.reply !== "") { alert(`📩 অ্যাডমিন রিপ্লাই:\nআপনার প্রশ্ন: ${data.message}\nউত্তর: ${data.reply}`); db.collection('support_tickets').doc(change.doc.id).delete(); } } }); }); }

function loadSupportTickets() { let tbody = document.getElementById('admin-ticket-list'); if(!tbody || !db) return; db.collection('support_tickets').orderBy('timestamp', 'desc').onSnapshot(snap => { tbody.innerHTML = ''; if(snap.empty) return tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">কোনো নতুন সাপোর্ট রিকোয়েস্ট নেই 🎉</td></tr>'; snap.forEach(doc => { let d = doc.data(); let statusTag = d.status === "Open" ? `🟡 Pending` : `🟢 Replied`; let actionBtn = d.status === "Open" ? `<button class="btn btn-primary btn-small" onclick="replyToTicket('${doc.id}', '${d.shopID}', '${d.message}')">Reply</button>` : `<button class="btn btn-danger btn-small" onclick="deleteTicket('${doc.id}')">Delete</button>`; tbody.innerHTML += `<tr><td><b>${d.shopName}</b><br><small>${d.shopID}</small></td><td>${d.message}</td><td>${statusTag}</td><td>${actionBtn}</td></tr>`; }); }); }
function replyToTicket(ticketID, shopID, message) { let replyTxt = prompt(`Shop: ${shopID}\nIssue: ${message}\n\nআপনার রিপ্লাই লিখুন:`); if(!replyTxt || replyTxt.trim() === "") return; db.collection('support_tickets').doc(ticketID).set({ reply: replyTxt.trim(), status: "Closed" }, { merge: true }).then(() => alert("✅ রিপ্লাই পাঠানো হয়েছে!")); }
function deleteTicket(ticketID) { if(confirm("ডিলিট করবেন?")) db.collection('support_tickets').doc(ticketID).delete(); }

function addPlan() { let name = document.getElementById('plan-name').value; let price = document.getElementById('plan-price').value; let days = document.getElementById('plan-days').value; if(!name || !price || !days) return alert("সব তথ্য দিন!"); db.collection('subscription_plans').add({ name: name, price: parseFloat(price), validity: parseInt(days) }).then(() => { alert("Plan added!"); loadPlans(); }); }
function loadPlans() { let tbody = document.getElementById('admin-plan-list'); if(!tbody || !db) return; db.collection('subscription_plans').get().then((snap) => { tbody.innerHTML = ''; snap.forEach((doc) => { let p = doc.data(); tbody.innerHTML += `<tr><td>${p.name}</td><td>৳${p.price}</td><td>${p.validity} Days</td><td><button class="btn btn-danger btn-small" onclick="deletePlan('${doc.id}')">X</button></td></tr>`; }); }); }
function deletePlan(id) { if(confirm("ডিলিট করবেন?")) db.collection('subscription_plans').doc(id).delete().then(() => loadPlans()); }

function showSubscriptionPlans() {
    document.getElementById('subscriptionModal').classList.remove('hidden');
    let planContainer = document.getElementById('customer-plan-list');
    planContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br>প্ল্যান লোড হচ্ছে...</div>';
    db.collection('subscription_plans').get().then((snap) => {
        planContainer.innerHTML = '';
        if(snap.empty) { planContainer.innerHTML = '<div style="grid-column: 1/-1; color: #ef4444; font-weight: bold;">বর্তমানে কোনো প্ল্যান নেই। অ্যাডমিনের সাথে যোগাযোগ করুন।</div>'; return; }
        snap.forEach(doc => {
            let p = doc.data();
            planContainer.innerHTML += `<div style="background: white; border: 2px solid #e2e8f0; border-radius: 10px; padding: 20px; transition: 0.3s; box-shadow: 0 4px 6px rgba(0,0,0,0.05);"><h3 style="color: #3b82f6; margin-bottom: 10px; font-size: 18px;">${p.name}</h3><h1 style="color: #0f172a; margin-bottom: 5px; font-size: 28px;">৳ ${p.price}</h1><p style="color: #64748b; font-size: 13px; margin-bottom: 20px;">মেয়াদ: ${p.validity} দিন</p><button onclick="buyPlan('${p.name}', ${p.price}, ${p.validity})" style="width: 100%; padding: 10px; background: #10b981; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;"><i class="fa-brands fa-whatsapp"></i> Buy Now</button></div>`;
        });
    }).catch(err => { planContainer.innerHTML = '<div style="grid-column: 1/-1; color: #ef4444;">ইন্টারনেট কানেকশন চেক করুন!</div>'; });
}

function buyPlan(planName, price, days) { let myShopID = currentShopID || "Unknown ID"; let myShopName = shopName || "Unknown Shop"; let adminWaNum = "8801621244970"; let msg = `আসসালামু আলাইকুম শাহারিয়া ভাই।\nআমি আপনার সফটওয়্যারটি আপগ্রেড করতে চাই।\n\n*আমার Shop ID:* ${myShopID}\n*Shop Name:* ${myShopName}\n*পছন্দের প্ল্যান:* ${planName} (৳${price} / ${days} দিন)\n\nদয়া করে আমাকে পেমেন্ট ডিটেইলস দিন।`; window.open(`https://wa.me/${adminWaNum}?text=${encodeURIComponent(msg)}`, '_blank'); }

function switchAdminTab(event, tabId) {
    let contents = document.querySelectorAll('.admin-tab-content'); contents.forEach(content => { content.style.display = 'none'; });
    let buttons = document.querySelectorAll('.admin-tab-btn'); buttons.forEach(btn => { btn.classList.remove('active'); btn.style.background = 'transparent'; btn.style.color = '#38bdf8'; });
    document.getElementById(tabId).style.display = 'block'; event.currentTarget.classList.add('active'); event.currentTarget.style.background = '#38bdf8'; event.currentTarget.style.color = '#0f172a';
}

function exportShopsToCSV() {
    let csvContent = "data:text/csv;charset=utf-8,Shop ID,Shop Name,Owner Name,WhatsApp,Email,Status\n"; let btn = event.currentTarget; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    db.collection('shops').get().then(snap => {
        let promises = [];
        snap.forEach(doc => { let d = doc.data(); let p = db.collection('licenses').doc(doc.id).get().then(lic => { let status = "Trial Mode"; if(lic.exists && lic.data().isActive) status = "Pro Active"; else if (lic.exists && !lic.data().isActive) status = "Suspended"; csvContent += `${doc.id},${d.shopName||'N/A'},${d.ownerName||'N/A'},${d.waNumber||'N/A'},${d.email||'N/A'},${status}\n`; }); promises.push(p); });
        Promise.all(promises).then(() => { let encodedUri = encodeURI(csvContent); let link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", "SmartPOS_Client_List.csv"); document.body.appendChild(link); link.click(); link.remove(); btn.innerHTML = '<i class="fa-solid fa-file-csv"></i> Download Client List'; alert("✅ ক্লায়েন্ট লিস্ট সফলভাবে ডাউনলোড হয়েছে!"); });
    });
}

function getMarketingNumbers(type) {
    let numbers = []; let btn = event.currentTarget; let originalText = btn.innerHTML; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Searching...';
    db.collection('shops').get().then(snap => {
        let promises = [];
        snap.forEach(doc => { let d = doc.data(); if(d.waNumber && d.waNumber.length >= 10) { let p = db.collection('licenses').doc(doc.id).get().then(lic => { if(type === 'trial' && !lic.exists) numbers.push(d.waNumber); if(type === 'suspended' && lic.exists && !lic.data().isActive) numbers.push(d.waNumber); }); promises.push(p); } });
        Promise.all(promises).then(() => {
            btn.innerHTML = originalText; if(numbers.length === 0) return alert(`❌ এই ক্যাটাগরিতে কোনো নম্বর পাওয়া যায়নি!`);
            let formattedNumbers = numbers.join(', '); let modalHTML = `<div id="marketing-modal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:999999; display:flex; align-items:center; justify-content:center; padding:20px;"><div style="background:#fff; padding:25px; border-radius:12px; width:100%; max-width:500px; color:#000;"><h3 style="margin-bottom:15px; color:#3b82f6;">Total Numbers Found: ${numbers.length}</h3><textarea id="copy-numbers-area" style="width:100%; height:150px; padding:10px; margin-bottom:15px; border:1px solid #ccc; border-radius:8px;">${formattedNumbers}</textarea><div style="display:flex; gap:10px;"><button class="btn btn-success" onclick="document.getElementById('copy-numbers-area').select(); document.execCommand('copy'); alert('Copied!');" style="flex:1;">Copy All</button><button class="btn btn-danger" onclick="document.getElementById('marketing-modal').remove()" style="flex:1;">Close</button></div></div></div>`; document.body.insertAdjacentHTML('beforeend', modalHTML);
        });
    });
}

function switchPage(pageId) {
    document.querySelectorAll('.page-section').forEach(p => { p.classList.add('hidden'); p.classList.remove('active'); });
    document.querySelectorAll('.nav-menu li').forEach(li => li.classList.remove('active'));
    const target = document.getElementById(pageId); if(target) { target.classList.remove('hidden'); target.classList.add('active'); }
    document.querySelectorAll('.nav-menu li').forEach(li => { if(li.getAttribute('onclick') && li.getAttribute('onclick').includes(`'${pageId}'`)) li.classList.add('active'); });
    let sidebar = document.querySelector('.sidebar'); let overlay = document.getElementById('sidebar-overlay');
    if(sidebar && sidebar.classList.contains('active')) { sidebar.classList.remove('active'); if(overlay) overlay.classList.remove('active'); }
    if(pageId === 'dashboard') switchDashboardView('daily'); 
    if(pageId === 'analytics' && typeof renderFullAnalytics === 'function') renderFullAnalytics(); 
    if(pageId === 'due' && typeof renderDueTable === 'function') renderDueTable();
    if(pageId === 'profile') loadUserProfileData(); 
}

function updateTime() { const t = document.getElementById('current-time'); if (t) t.innerText = new Date().toLocaleString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function checkNetworkStatus() { const badge = document.getElementById('network-badge'); if(!badge) return; if(navigator.onLine) { badge.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Online Sync'; badge.style.background = '#10b981'; } else { badge.innerHTML = '<i class="fa-solid fa-wifi"></i> Offline Mode'; badge.style.background = '#ef4444'; } }

function switchDashboardView(viewMode) {
    let now = new Date(); let tSell = 0, tProfit = 0, tDueCol = 0, tCost = 0, countBills = 0; let mSell = 0, mProfit = 0, mCost = 0; 
    salesHistoryDB.forEach(sale => { 
        let sd = new Date(sale.rawDate || sale.date); let profitAmt = sale.profit !== undefined ? sale.profit : (sale.total - (sale.total * 0.85)); 
        if(sd.getMonth() === now.getMonth() && sd.getFullYear() === now.getFullYear()) { mSell += sale.total; mProfit += profitAmt; } 
        if(sd.toDateString() === now.toDateString()) { tSell += sale.total; tProfit += profitAmt; countBills++; } 
    });
    dueCollectionHistoryDB.forEach(col => { let cd = new Date(col.rawDate || col.date); if(cd.toDateString() === now.toDateString()) tDueCol += col.amount; }); 
    expensesDB.forEach(exp => { 
        let ed = exp.rawDate ? new Date(exp.rawDate) : new Date(exp.date); 
        if(ed.getMonth() === now.getMonth() && ed.getFullYear() === now.getFullYear()) { mCost += exp.amount; }
        if(ed.toDateString() === now.toDateString()) { tCost += exp.amount; }
    });
    
    let totalMarketDue = customersDB.reduce((sum, cus) => sum + cus.due, 0); let tNetProfit = tProfit - tCost; let mNetProfit = mProfit - mCost;
    let dtp = document.getElementById('dash-today-profit'); if(dtp) dtp.innerText = `৳ ${tProfit.toFixed(2)}`; 
    let dtnp = document.getElementById('dash-today-net-profit'); if(dtnp) dtnp.innerText = `৳ ${tNetProfit.toFixed(2)}`; 
    let dts = document.getElementById('dash-today-sell'); if(dts) dts.innerText = `৳ ${tSell.toFixed(2)}`; 
    let dtc = document.getElementById('dash-today-cost'); if(dtc) dtc.innerText = `৳ ${tCost.toFixed(2)}`; 
    let dtdc = document.getElementById('dash-today-due-col'); if(dtdc) dtdc.innerText = `৳ ${tDueCol.toFixed(2)}`; 
    let dca = document.getElementById('dash-today-cash'); if(dca) dca.innerText = `৳ ${((tSell + tDueCol) - tCost).toFixed(2)}`; 
    let dtb = document.getElementById('dash-today-bills'); if(dtb) dtb.innerText = `${countBills} টি`; 
    let dms = document.getElementById('dash-month-sell'); if(dms) dms.innerText = `৳ ${mSell.toFixed(2)}`; 
    let dmp = document.getElementById('dash-month-profit'); if(dmp) dmp.innerText = `৳ ${mProfit.toFixed(2)}`; 
    let dmc = document.getElementById('dash-month-cost'); if(dmc) dmc.innerText = `৳ ${mCost.toFixed(2)}`; 
    let dmnp = document.getElementById('dash-month-net-profit'); if(dmnp) dmnp.innerText = `৳ ${mNetProfit.toFixed(2)}`; 
    let dtd = document.getElementById('dash-total-due'); if(dtd) dtd.innerText = `৳ ${totalMarketDue.toFixed(2)}`;
    
    if(typeof updateChartData === 'function') updateChartData(); 
    if(typeof updateDashboardAlerts === 'function') updateDashboardAlerts();
}

function updateDashboardAlerts() {
    let transHtml = ''; salesHistoryDB.slice(0, 5).forEach(s => { transHtml += `<li><div><b>${s.customer}</b><br><small style="font-size:10px;">${s.date.split(',')[0]}</small></div><b style="color:#10b981;">+ ৳${s.total.toFixed(0)}</b></li>`; }); let r = document.getElementById('dash-recent-trans'); if(r) r.innerHTML = transHtml || '<li>No transactions</li>';
    let dueHtml = ''; let topDebtors = [...customersDB].filter(c => c.due > 0).sort((a, b) => b.due - a.due).slice(0, 5); topDebtors.forEach(c => { dueHtml += `<li><span><i class="fa-solid fa-user"></i> ${c.name}</span><b style="color:#ef4444;">৳${c.due.toFixed(0)}</b></li>`; }); let d = document.getElementById('dash-due-reminder'); if(d) d.innerHTML = dueHtml || '<li>All clear!</li>';
    let stockHtml = ''; let lowStocks = [...productsDB].filter(p => p.stock <= 5).slice(0, 5); lowStocks.forEach(p => { stockHtml += `<li><span><i class="fa-solid fa-box"></i> ${p.name}</span><b style="color:#ef4444;">${p.stock} ${p.unit||'Pcs'}</b></li>`; }); let l = document.getElementById('dash-low-stock'); if(l) l.innerHTML = stockHtml || '<li>Stock is healthy!</li>';
    let topProdHtml = ''; [...productsDB].filter(p=>p.isTop).slice(0,5).forEach(p => { topProdHtml += `<li><span>🔥 ${p.name}</span><b style="color:#3b82f6;">৳${p.sell}</b></li>`; }); let tp = document.getElementById('dash-top-products'); if(tp) tp.innerHTML = topProdHtml || '<li>No top products</li>';
}

function initChart() { 
    const ctx1 = document.getElementById('myChart'); if(!ctx1) return; 
    if (salesChart) { salesChart.destroy(); }
    let config = { type: 'line', data: { labels: ['6 Days Ago','5 Days Ago','4 Days Ago','3 Days Ago','2 Days Ago','Yesterday','Today'], datasets: [{ label: 'Sales Trend (৳)', data: [0,0,0,0,0,0,0], borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.2)', borderWidth: 2, fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false } }; 
    if(typeof Chart !== 'undefined') salesChart = new Chart(ctx1, config); 
}

function updateChartData() { if(!salesChart) return; let dayTotals = [0,0,0,0,0,0,0]; let labels = []; for(let i=6; i>=0; i--) { let d = new Date(); d.setDate(d.getDate() - i); labels.push(i===0?'Today':i===1?'Yesterday':d.toLocaleDateString('en-US', {weekday:'short'})); salesHistoryDB.forEach(s => { let sd = new Date(s.rawDate || s.date); if(sd.toDateString() === d.toDateString()) dayTotals[6-i] += s.total; }); } salesChart.data.labels = labels; salesChart.data.datasets[0].data = dayTotals; salesChart.update(); }

// ================= CUSTOMERS & PRODUCTS =================
function renderAllTables() {
    const prodBody = document.getElementById('prod-list-body'); let lowStockCount = 0;
    if(prodBody) {
        let prodHtml = ''; 
        productsDB.forEach((p) => {
            if(p.stock <= 5) lowStockCount++;
            let stockStatus = p.stock <= 0 ? '<span style="color:#ef4444; font-weight:bold;">Out of Stock</span>' : (p.stock <= 5 ? `<span style="color:#f59e0b; font-weight:bold;">Low: ${p.stock} ${p.unit||'Pcs'}</span>` : `${p.stock} ${p.unit||'Pcs'}`);
            let imgSrc = (p.img && p.img.length > 50) ? p.img : `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=e0f2fe&color=0284c7`;
            prodHtml += `<tr><td style="display: flex; align-items:center; gap:10px;"><img src="${imgSrc}" style="width:40px; height:40px; border-radius:5px; object-fit:cover; border: 1px solid #e2e8f0;"><b>${p.name}</b></td><td>${stockStatus}</td><td>৳ ${p.buy}</td><td>৳ ${p.sell}</td><td class="no-print"><button class="btn btn-primary btn-small" onclick="editProduct('${p.name}')"><i class="fa-solid fa-pen"></i></button> <button class="btn btn-danger btn-small" onclick="deleteProduct('${p.name}')"><i class="fa-solid fa-trash"></i></button></td></tr>`;
        });
        prodBody.innerHTML = prodHtml; 
        if(document.getElementById('stat-total-items')) document.getElementById('stat-total-items').innerText = productsDB.length;
        if(document.getElementById('stat-low-stock')) document.getElementById('stat-low-stock').innerText = lowStockCount;
    }

    const cusBody = document.getElementById('cus-list-body');
    if(cusBody) {
        let cusHtml = ''; 
        customersDB.forEach((c) => {
            let catTag = c.category === 'VIP' ? '<span style="background:#fef3c7; color:#d97706; padding:3px 8px; border-radius: 12px; font-size:10px; font-weight:bold;"> VIP</span>' : '<span style="background:#f1f5f9; color:#64748b; padding:3px 8px; border-radius:12px; font-size:10px;">Normal</span>';
            let imgSrc = (c.img && c.img.length > 50) ? c.img : `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=random&color=fff&rounded=true`;
            cusHtml += `<tr><td onclick="viewCustomerLedger('${c.name}')" style="cursor:pointer; display: flex; align-items:center; gap:12px;"><img src="${imgSrc}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border: 1px solid #e2e8f0; background: #fff;"><div><b>${c.name}</b><br><small style="color:#64748b;">${c.phone}</small></div></td><td>${catTag}</td><td style="color:#ef4444; font-weight:bold;">৳ ${c.due.toFixed(2)}</td><td class="no-print"><button class="btn btn-success btn-small" onclick="sendDueWhatsApp('${c.phone}', '${c.name}', ${c.due})" title="Send Reminder"><i class="fa-brands fa-whatsapp"></i></button> <button class="btn btn-primary btn-small" onclick="editCustomer('${c.name}')"><i class="fa-solid fa-pencil"></i></button> <button class="btn btn-danger btn-small" onclick="deleteCustomer('${c.name}')"><i class="fa-solid fa-trash"></i></button></td></tr>`;
        });
        cusBody.innerHTML = cusHtml; 
    }
    if(typeof renderDueTable === "function") renderDueTable();
}

function openCustomerModal() { document.getElementById('editCusIndex').value = "-1"; document.getElementById('cus-modal-title').innerText = "Add New Customer"; document.getElementById('newCusName').value = ''; document.getElementById('newCusPhone').value = ''; document.getElementById('newCusDue').value = '0'; document.getElementById('cus-img-preview').src = "https://via.placeholder.com/80?text=User"; document.getElementById('addCustomerModal').classList.remove('hidden'); }
function editCustomer(name) { let c = customersDB.find(cus => cus.name === name); if(!c) return; document.getElementById('editCusIndex').value = name; document.getElementById('cus-modal-title').innerText = "Edit: " + name; document.getElementById('newCusName').value = c.name; document.getElementById('newCusPhone').value = c.phone; document.getElementById('newCusDue').value = c.due; document.getElementById('cus-img-preview').src = c.img && c.img.length > 50 ? c.img : "https://via.placeholder.com/80?text=User"; document.getElementById('addCustomerModal').classList.remove('hidden'); }
function saveNewCustomer() { const name = document.getElementById('newCusName').value.trim(); const phone = document.getElementById('newCusPhone').value.trim(); const due = parseFloat(document.getElementById('newCusDue').value) || 0; let imgData = document.getElementById('cus-img-preview').src; if(imgData.includes('via.placeholder.com')) imgData = ""; if (!name || !phone) return alert("নাম ও ফোন দিন!"); let editIdx = document.getElementById('editCusIndex').value; if(editIdx !== "-1") { let c = customersDB.find(cus => cus.name === editIdx); if(c) { c.name = name; c.phone = phone; c.due = due; c.img = imgData; } } else { if(customersDB.find(c => c.name.toLowerCase() === name.toLowerCase())) return alert("এই নামে অলরেডি কাস্টমার আছে!"); customersDB.push({ name, phone, category: "Normal", due, limit: 5000, img: imgData }); } saveData(); document.getElementById('addCustomerModal').classList.add('hidden'); renderAllTables(); populateDropdowns(); }
function deleteCustomer(name) { if(confirm("ডিলিট করবেন?")) { customersDB = customersDB.filter(c => c.name !== name); saveData(); renderAllTables(); populateDropdowns(); } }

function viewCustomerLedger(name) { activeLedgerCus = name; let c = customersDB.find(cus => cus.name === name); if(!c) return; document.getElementById('history-cus-name').innerText = c.name; document.getElementById('ledger-tot-due').innerText = `৳ ${c.due.toFixed(2)}`; let tbody = document.getElementById('history-list-body'); tbody.innerHTML = ''; let totalBuy = 0; salesHistoryDB.forEach(s => { if(s.customer === name) { totalBuy += s.total; tbody.innerHTML += `<tr><td>${s.date.split(',')[0]}</td><td style="color:#1e293b; font-weight:bold;">Bill (${s.invoice})</td><td style="color:#ef4444;">- ৳${s.total.toFixed(2)}</td></tr>`; } }); dueCollectionHistoryDB.forEach(col => { if(col.customer === name) { tbody.innerHTML += `<tr><td>${col.date.split(',')[0]}</td><td style="color:#1e293b; font-weight:bold;">Payment</td><td style="color:#10b981;">+ ৳${col.amount.toFixed(2)}</td></tr>`; } }); document.getElementById('ledger-tot-buy').innerText = `৳ ${totalBuy.toFixed(2)}`; document.getElementById('historyModal').classList.remove('hidden'); }
function receiveDuePrompt() { let amt = parseFloat(prompt(`কত টাকা রিসিভ করছেন?`)); if(amt > 0) { let c = customersDB.find(cus => cus.name === activeLedgerCus); c.due = Math.max(0, c.due - amt); dueCollectionHistoryDB.unshift({ date: new Date().toLocaleString(), rawDate: new Date().getTime(), customer: activeLedgerCus, amount: amt }); saveData(); alert("Payment Received!"); viewCustomerLedger(activeLedgerCus); renderAllTables(); switchDashboardView('daily'); } }
function filterCustomerTable() { let f = document.getElementById('cus-search-page').value.toUpperCase(); document.querySelectorAll('#cus-list-body tr').forEach(r => { r.style.display = r.innerText.toUpperCase().indexOf(f) > -1 ? "" : "none"; }); }

function openProductModal() { document.getElementById('editProdIndex').value = "-1"; document.getElementById('product-modal-title').innerHTML = 'Add Product'; document.getElementById('newProdName').value = ''; document.getElementById('newBuyPrice').value = ''; document.getElementById('newSellPrice').value = ''; document.getElementById('newStock').value = ''; document.getElementById('img-preview').src = "https://via.placeholder.com/100?text=Upload"; document.getElementById('addProductModal').classList.remove('hidden'); }
function editProduct(name) { let p = productsDB.find(prod => prod.name === name); if(!p) return; document.getElementById('editProdIndex').value = name; document.getElementById('newProdName').value = p.name; document.getElementById('newBuyPrice').value = p.buy; document.getElementById('newSellPrice').value = p.sell; document.getElementById('newStock').value = p.stock; document.getElementById('img-preview').src = p.img && p.img.length > 50 ? p.img : "https://via.placeholder.com/100?text=Upload"; document.getElementById('addProductModal').classList.remove('hidden'); }
function saveNewProduct() { const name = document.getElementById('newProdName').value.trim(); const buy = parseFloat(document.getElementById('newBuyPrice').value) || 0; const sell = parseFloat(document.getElementById('newSellPrice').value) || 0; const stock = parseFloat(document.getElementById('newStock').value); let imgData = document.getElementById('img-preview').src; if(imgData.includes('via.placeholder.com')) imgData = ""; if (!name || isNaN(stock) || isNaN(sell)) return alert("সব তথ্য দিন!"); let editNameRef = document.getElementById('editProdIndex').value; if(editNameRef !== "-1") { let p = productsDB.find(prod => prod.name === editNameRef); if(p) { p.name = name; p.buy = buy; p.sell = sell; p.stock = stock; p.img = imgData; } } else { productsDB.push({ name, stock, buy, sell, unit: 'Pcs', img: imgData, isTop: false }); } saveData(); document.getElementById('addProductModal').classList.add('hidden'); renderAllTables(); populateDropdowns(); }
function deleteProduct(name) { if(confirm("মুছবেন?")) { productsDB = productsDB.filter(p => p.name !== name); saveData(); renderAllTables(); populateDropdowns(); } }
function searchProductTable() { let f = document.getElementById('prod-search-input').value.toUpperCase(); document.querySelectorAll('#prod-list-body tr').forEach(r => { r.style.display = r.innerText.toUpperCase().indexOf(f) > -1 ? "" : "none"; }); }
function filterLowStock() { document.querySelectorAll('#prod-list-body tr').forEach(r => { if(!r.innerHTML.includes('Low:') && !r.innerHTML.includes('Out of Stock')) r.style.display = 'none'; else r.style.display = ''; }); }

function compressAndPreview(event, imgElementId) {
    const file = event.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image(); img.onload = function() {
            const canvas = document.createElement('canvas'); const maxSize = 150; let width = img.width; let height = img.height;
            if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } } else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } }
            canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
            document.getElementById(imgElementId).src = canvas.toDataURL('image/jpeg', 0.8);
        }; img.src = e.target.result;
    }; reader.readAsDataURL(file);
}
function previewImage(event) { compressAndPreview(event, 'img-preview'); }
function previewCusImage(event) { compressAndPreview(event, 'cus-img-preview'); }

function toggleDropdown(id) { document.getElementById(id).classList.toggle('hidden'); }
function filterDropdown(inputId, listId) { 
    const filter = document.getElementById(inputId).value.toUpperCase(); const div = document.getElementById(listId); if(!div) return; 
    const items = div.getElementsByClassName('item'); div.classList.remove('hidden'); 
    for (let i = 0; i < items.length; i++) { let txt = items[i].innerText.toUpperCase(); items[i].style.display = txt.indexOf(filter) > -1 ? "flex" : "none"; } 
}

// ================= CART & BILLING =================
function populateDropdowns() {
    const cusList = document.getElementById('cus-dropdown-list'); 
    if(cusList) { 
        let cusHtml = `<div onclick="openCustomerModal()" style="padding:10px; background:#e0f2fe; color:#0284c7; font-weight:bold; text-align:center; cursor:pointer; border-bottom:1px solid #bae6fd;"><i class="fa-solid fa-user-plus"></i> + Add New Customer</div>`; 
        customersDB.forEach(c => { 
            let imgSrc = (c.img && c.img.length > 50) ? c.img : `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=random&color=fff&rounded=true`;
            cusHtml += `<div class="item" onclick="selectCustomer('${c.name}', ${c.due})" style="padding:10px; border-bottom:1px solid #eee; cursor:pointer; display:flex; align-items:center; gap:10px;"><img src="${imgSrc}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:1px solid #ccc;"><div style="flex:1;"><b style="font-size:15px; color:#1e293b; display:block;">${c.name}</b><small style="color:#64748b;">Phone: ${c.phone} | Due: ৳${c.due.toFixed(2)}</small></div></div>`; 
        }); 
        cusList.innerHTML = cusHtml; 
    }

    const prodList = document.getElementById('prod-dropdown-list'); 
    if(prodList) { 
        let prodHtml = ''; 
        productsDB.forEach(p => { 
            let imgSrc = (p.img && p.img.length > 50) ? p.img : `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=e0f2fe&color=0284c7`;
            prodHtml += `<div class="item" onclick="selectProduct('${p.name}', ${p.sell}, ${p.buy})" style="padding:12px; border-bottom:1px solid #eee; cursor:pointer; display:flex; align-items:center; gap:12px;"><img src="${imgSrc}" style="width:45px; height:45px; border-radius:6px; object-fit:cover; border:1px solid #ccc;"><div style="flex:1;"><b style="font-size:16px; color:#1e293b; display:block;">${p.name}</b><small style="color:#f59e0b; font-weight:bold;">Stock: ${p.stock} ${p.unit||'Pcs'}</small></div><div style="font-size:16px; font-weight:bold; color:#3b82f6;">৳${p.sell}</div></div>`; 
        }); 
        prodList.innerHTML = prodHtml; 
    }

    const salesFilter = document.getElementById('sales-customer-filter');
    if(salesFilter) {
        let currentVal = salesFilter.value;
        let sfHtml = '<option value="All">All Customers</option>';
        let uniqueCustomers = [...new Set(salesHistoryDB.map(item => item.customer))];
        uniqueCustomers.forEach(name => { if(name && name !== "Walk-in") sfHtml += `<option value="${name}">${name}</option>`; });
        sfHtml += `<option value="Walk-in">Walk-in</option>`;
        salesFilter.innerHTML = sfHtml; salesFilter.value = currentVal || "All";
    }
}

function selectCustomer(name, dueAmt) { document.getElementById('cus-search-billing').value = name; document.getElementById('cus-dropdown-list').classList.add('hidden'); currentCustomerDue = dueAmt || 0; document.getElementById('bill-prev-due').innerText = `৳ ${currentCustomerDue.toFixed(2)}`; calculateCartTotal(); }
function walkIn() { document.getElementById('cus-search-billing').value = "Walk-in"; document.getElementById('cus-dropdown-list').classList.add('hidden'); currentCustomerDue = 0; document.getElementById('bill-prev-due').innerText = `৳ 0`; calculateCartTotal(); }
function selectProduct(name, price, buyPrice) { document.getElementById('billing-product-search').value = ""; document.getElementById('prod-dropdown-list').classList.add('hidden'); addToCart(name, 1, price, buyPrice); }

function addToCart(name, qty, price, buyPrice) { 
    let existing = cartItems.find(i => i.name === name); 
    if(existing) { existing.qty += parseFloat(qty); } 
    else { if(buyPrice === undefined) { let p = productsDB.find(prod => prod.name === name); buyPrice = p ? p.buy : 0; } cartItems.push({ name, qty: parseFloat(qty), price, buyPrice }); } 
    renderCart(); 
}

function renderCart() {
    const body = document.getElementById('cart-items'); if(!body) return; body.innerHTML = ''; let subtotal = 0;
    if(cartItems.length === 0) {
        body.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:20px;">কোনো প্রোডাক্ট যোগ করা হয়নি</td></tr>`;
    } else {
        cartItems.forEach((item, i) => { 
            let total = item.qty * item.price; subtotal += total; 
            body.innerHTML += `
            <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="font-weight:600; color:#1e293b; font-size:15px;">${item.name}</td>
                <td style="display:flex; align-items:center; gap:5px;">
                    <button style="background:#e2e8f0; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-weight:bold;" onclick="updateQty(${i}, ${item.qty - 1})">-</button>
                    <input type="number" value="${item.qty}" style="width:50px; text-align:center; padding:4px; margin:0; font-weight:bold; border:1px solid #cbd5e1; border-radius:4px;" onchange="updateQty(${i}, this.value)">
                    <button style="background:#e2e8f0; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-weight:bold;" onclick="updateQty(${i}, ${item.qty + 1})">+</button>
                </td>
                <td><input type="number" value="${item.price}" style="width:70px; padding:4px; margin:0; border:1px solid #cbd5e1; border-radius:4px;" onchange="updateCartPrice(${i}, this.value)"></td>
                <td style="font-weight:bold; color:#3b82f6;">৳${total.toFixed(2)}</td>
                <td><button class="btn btn-danger btn-small" onclick="removeFromCart(${i})"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`; 
        }); 
    }
    cartTotal = subtotal; calculateCartTotal();
}

function updateQty(i, val) { let qty = parseFloat(val); if (qty <= 0 || isNaN(qty)) qty = 1; cartItems[i].qty = qty; renderCart(); }
function updateCartPrice(i, val) { let p = parseFloat(val); if (p < 0 || isNaN(p)) p = 0; cartItems[i].price = p; renderCart(); }
function removeFromCart(i) { cartItems.splice(i, 1); renderCart(); }

function calculateCartTotal() {
    document.getElementById('bill-subtotal').innerText = `৳ ${cartTotal.toFixed(2)}`; let chk = document.getElementById('chk-prev-due'); let prevDueToAdd = (chk && chk.checked) ? currentCustomerDue : 0; let discInput = document.getElementById('bill-discount'); let discount = parseFloat(discInput ? discInput.value : 0) || 0;
    let grandTotal = Math.max(0, (cartTotal + prevDueToAdd) - discount); document.getElementById('bill-grand-total').innerText = `Total: ৳ ${grandTotal.toFixed(2)}`;
    let paidInput = document.getElementById('bill-paid'); if(paidInput) paidInput.value = grandTotal > 0 ? grandTotal.toFixed(2) : ''; updateDueCalculation(grandTotal);
}

function updateDueCalculation(gTotal) { let grandTotal = gTotal !== undefined ? gTotal : parseFloat(document.getElementById('bill-grand-total').innerText.replace('Total: ৳ ', '')) || 0; const paidAmt = parseFloat(document.getElementById('bill-paid') ? document.getElementById('bill-paid').value : 0) || 0; let dueAmt = document.getElementById('bill-due-amount'); if(dueAmt) dueAmt.value = Math.max(0, grandTotal - paidAmt).toFixed(2); }
function clearCart() { if(confirm("কার্ট মুছবেন?")) { cartItems = []; renderCart(); walkIn(); } }
function holdInvoice() { if(cartItems.length === 0) return; let cusName = document.getElementById('cus-search-billing').value || "Walk-in"; holdInvoices.push({ id: Date.now(), customer: cusName, items: [...cartItems] }); cartItems = []; renderCart(); alert("Hold Successful!"); walkIn(); }
function showHoldList() { if(holdInvoices.length === 0) return alert("কোনো বিল নেই!"); let listStr = holdInvoices.map((inv, i) => `${i+1}. ${inv.customer}`).join('\n'); let choice = prompt(`হোল্ড বিল:\n${listStr}\nনম্বর লিখুন:`); if(choice && holdInvoices[choice-1]) { cartItems = holdInvoices[choice-1].items; document.getElementById('cus-search-billing').value = holdInvoices[choice-1].customer; holdInvoices.splice(choice-1, 1); renderCart(); } }

function finalizeSale(action) {
    if(cartItems.length === 0) return alert("কার্ট খালি! কোনো প্রোডাক্ট সিলেক্ট করুন।");
    let grandTotal = parseFloat(document.getElementById('bill-grand-total').innerText.replace('Total: ৳ ', '')) || 0; 
    let paidAmt = parseFloat(document.getElementById('bill-paid').value) || 0; 
    let currentDue = parseFloat(document.getElementById('bill-due-amount').value) || 0; 
    let cusName = document.getElementById('cus-search-billing').value.trim() || "Walk-in";
    
    let invoiceNo = "INV-" + Math.floor(Math.random() * 90000 + 10000); 
    let dateObj = new Date(); let date = dateObj.toLocaleString('en-US');
    
    let chk = document.getElementById('chk-prev-due'); let pDue = (chk && chk.checked) ? currentCustomerDue : 0;
    let discInput = document.getElementById('bill-discount'); let discount = parseFloat(discInput ? discInput.value : 0) || 0;
    
    let customerObj = customersDB.find(c => c.name.toLowerCase() === cusName.toLowerCase()); 
    if(!customerObj && cusName.toLowerCase() !== "walk-in") { customersDB.push({ name: cusName, phone: "N/A", category: "Normal", due: 0, limit: 5000, img: "" }); customerObj = customersDB[customersDB.length - 1]; }
    
    let printItemsHtml = `<table style="width:100%; border-collapse: collapse; margin: 15px 0; font-size: 13px; text-align: left;"><tr style="border-bottom: 2px solid #333;"><th style="padding:5px 0; background:transparent;">বিবরণ</th><th style="background:transparent;">পরিমাণ</th><th style="text-align:right; background:transparent;">মোট (৳)</th></tr>`;
    let waItemsText = ``;
    
    cartItems.forEach(item => {
        let itemTotal = item.qty * item.price;
        printItemsHtml += `<tr style="border-bottom: 1px dotted #ccc;"><td style="padding:5px 0;">${item.name}<br><small>@৳${item.price}</small></td><td>${item.qty}</td><td style="text-align:right;">${itemTotal.toFixed(2)}</td></tr>`;
        waItemsText += `▪ ${item.name} (${item.qty} x ${item.price}) = ৳${itemTotal.toFixed(2)}\n`;
    });
    printItemsHtml += `</table>`;
    
    let waMessage = `*${shopName}*\n📅 ${dateObj.toLocaleDateString()}\n🧾 Inv: ${invoiceNo}\n👤 Customer: ${cusName}\n\n*-- আইটেমসমূহ --*\n${waItemsText}\n*Subtotal:* ৳${cartTotal.toFixed(2)}\n` + (pDue > 0 ? `*Prev. Due:* ৳${pDue.toFixed(2)}\n` : ``) + (discount > 0 ? `*Discount:* -৳${discount.toFixed(2)}\n` : ``) + `-------------------\n*Grand Total: ৳${grandTotal.toFixed(2)}*\n*Paid:* ৳${paidAmt.toFixed(2)}\n*Current Due:* ৳${currentDue.toFixed(2)}\n\nধন্যবাদ! আবার আসবেন।`;

    let totalBuyCost = 0; let savedItems = JSON.parse(JSON.stringify(cartItems)); 
    cartItems.forEach(i => { let p = productsDB.find(prod => prod.name === i.name); if(p) p.stock -= i.qty; totalBuyCost += (i.qty * (i.buyPrice || 0)); });
    let invoiceProfit = grandTotal - totalBuyCost;

    salesHistoryDB.unshift({ 
        invoice: invoiceNo, date: date, rawDate: dateObj.getTime(), 
        customer: cusName, total: grandTotal, paid: paidAmt, due: currentDue, profit: invoiceProfit, items: savedItems, pDue: pDue, discount: discount 
    });
    
    if(customerObj) { customerObj.due = (customerObj.due - pDue) + currentDue; if(customerObj.due < 0) customerObj.due = 0; }
    saveData(); 

    if(action === 'print') { 
        let finalInvoiceHTML = `<div style="font-family: 'Hind Siliguri', sans-serif; color: #000; max-width: 300px; margin: 0 auto; padding: 10px;"><h2 style="text-align:center; margin-bottom: 5px; color: #000; font-size: 22px;">${shopName}</h2><div style="text-align:center; font-size:12px; margin-bottom: 15px;">মোবাইল: ${waNumber || "N/A"}</div><div style="font-size:13px; border-bottom:1px solid #000; padding-bottom:5px; margin-bottom: 5px;"><b>Inv No:</b> ${invoiceNo}<br><b>Date:</b> ${dateObj.toLocaleString('en-US', {hour12:true})}<br><b>Customer:</b> ${cusName}</div>${printItemsHtml}<div style="text-align:right; font-size:14px; margin-top: 10px;"><p style="margin:2px 0;">Subtotal: ৳${cartTotal.toFixed(2)}</p>${pDue > 0 ? `<p style="margin:2px 0;">Prev. Due: ৳${pDue.toFixed(2)}</p>` : ``}${discount > 0 ? `<p style="margin:2px 0;">Discount: -৳${discount.toFixed(2)}</p>` : ``}<h3 style="border-top:1px solid #000; padding-top:5px; margin-top:5px; font-size: 16px;">Total: ৳${grandTotal.toFixed(2)}</h3><p style="margin:2px 0;">Paid: ৳${paidAmt.toFixed(2)}</p><p style="margin:2px 0; font-weight:bold;">Due: ৳${currentDue.toFixed(2)}</p></div><div style="text-align:center; margin-top:20px; font-size:12px; border-top: 1px dashed #000; padding-top: 10px;">*** বিক্রিত মাল ফেরত নেওয়া হয় না ***<br>ধন্যবাদ, আবার আসবেন!</div></div>`; 
        printHTML(finalInvoiceHTML); setTimeout(resetBillingPage, 1000); 
    } else if (action === 'whatsapp') { 
        let phone = customerObj ? customerObj.phone : ""; if(!phone || phone === "N/A") alert("কাস্টমারের নম্বর নেই! শুধু সিস্টেমে সেভ করা হচ্ছে।"); else window.open(`https://wa.me/${phone.startsWith('0') ? '88' + phone : phone}?text=${encodeURIComponent(waMessage)}`, '_blank'); resetBillingPage();
    } else { alert(`✅ বিল সফলভাবে সেভ হয়েছে!`); resetBillingPage(); }
}

function resetBillingPage() { renderAllTables(); populateDropdowns(); renderSalesHistory(); cartItems = []; renderCart(); walkIn(); }

// ================= SALES HISTORY & INVOICE =================
function viewInvoice(invNo) {
    let sale = salesHistoryDB.find(s => s.invoice === invNo); if(!sale) return alert("Invoice not found!");
    let printItemsHtml = `<table style="width:100%; border-collapse: collapse; margin: 15px 0; font-size: 13px; text-align: left;"><tr style="border-bottom: 2px solid #333;"><th style="padding:5px 0;">বিবরণ</th><th>পরিমাণ</th><th style="text-align:right;">মোট (৳)</th></tr>`;
    let cartSubTotal = 0;
    if(sale.items && sale.items.length > 0) { sale.items.forEach(item => { let itemTotal = item.qty * item.price; cartSubTotal += itemTotal; printItemsHtml += `<tr style="border-bottom: 1px dotted #ccc;"><td style="padding:5px 0;">${item.name}<br><small>@৳${item.price}</small></td><td>${item.qty}</td><td style="text-align:right;">${itemTotal.toFixed(2)}</td></tr>`; }); } 
    else { printItemsHtml += `<tr><td colspan="3" style="text-align:center; padding:10px;">পুরানো বিলের আইটেম ডিটেইলস সেভ করা নেই।</td></tr>`; cartSubTotal = sale.total; }
    printItemsHtml += `</table>`;
    let pDue = sale.pDue || 0; let discount = sale.discount || 0;

    document.getElementById('reprint-invoice-area').innerHTML = `<div style="font-family: 'Hind Siliguri', sans-serif; color: #000; padding: 10px; max-width: 300px; margin: 0 auto;"><h2 style="text-align:center; margin-bottom: 5px; color: #000; font-size: 22px;">${shopName}</h2><div style="text-align:center; font-size:12px; margin-bottom: 15px;">মোবাইল: ${waNumber || "N/A"}</div><div style="font-size:13px; border-bottom:1px solid #000; padding-bottom:5px; margin-bottom: 5px;"><b>Inv No:</b> ${sale.invoice}<br><b>Date:</b> ${sale.date.split(',')[0]}<br><b>Customer:</b> ${sale.customer}</div>${printItemsHtml}<div style="text-align:right; font-size:14px; margin-top: 10px;"><p style="margin:2px 0;">Subtotal: ৳${cartSubTotal.toFixed(2)}</p>${pDue > 0 ? `<p style="margin:2px 0;">Prev. Due: ৳${pDue.toFixed(2)}</p>` : ``}${discount > 0 ? `<p style="margin:2px 0;">Discount: -৳${discount.toFixed(2)}</p>` : ``}<h3 style="border-top:1px solid #000; padding-top:5px; margin-top:5px; font-size: 16px;">Total: ৳${sale.total.toFixed(2)}</h3><p style="margin:2px 0;">Paid: ৳${sale.paid.toFixed(2)}</p><p style="margin:2px 0; font-weight:bold;">Due: ৳${sale.due.toFixed(2)}</p></div><div style="text-align:center; margin-top:20px; font-size:12px; border-top: 1px dashed #000; padding-top: 10px;">*** বিক্রিত মাল ফেরত নেওয়া হয় না ***<br>ধন্যবাদ, আবার আসবেন!</div></div>`;
    document.getElementById('invoiceModal').classList.remove('hidden');
}

function deleteInvoice(invNo) {
    if(!confirm("আপনি কি নিশ্চিত এই ইনভয়েসটি মুছে ফেলতে চান? \nমুছে ফেললে প্রোডাক্টের স্টক এবং কাস্টমারের বাকি অটোমেটিক ঠিক হয়ে যাবে!")) return;
    let saleIdx = salesHistoryDB.findIndex(s => s.invoice === invNo); if(saleIdx === -1) return; let sale = salesHistoryDB[saleIdx];
    if(sale.items) { sale.items.forEach(item => { let p = productsDB.find(prod => prod.name === item.name); if(p) p.stock += item.qty; }); }
    if(sale.due > 0 && sale.customer !== "Walk-in") { let c = customersDB.find(cus => cus.name === sale.customer); if(c) { c.due -= sale.due; if(c.due < 0) c.due = 0; } }
    salesHistoryDB.splice(saleIdx, 1); saveData(); renderAllTables(); renderSalesHistory(); switchDashboardView('daily'); alert("✅ ইনভয়েস সফলভাবে মুছে ফেলা হয়েছে এবং স্টক ব্যাক করা হয়েছে!");
}

function renderSalesHistory(filterCus = "All") {
    const tbody = document.getElementById('sales-history-body'); if(!tbody) return; let tS = 0, tP = 0, tD = 0; let html = ''; let lastDate = '';
    let todayStr = new Date().toLocaleDateString('en-US'); 
    let sortedSales = [...salesHistoryDB].sort((a, b) => new Date(b.rawDate || b.date) - new Date(a.rawDate || a.date));

    sortedSales.forEach(s => {
        if(filterCus === "All" || s.customer === filterCus) {
            tS += s.total; tP += s.paid; tD += s.due;
            let sDate = s.date.split(',')[0].trim(); let timeStr = s.date.split(',')[1] ? s.date.split(',')[1].trim() : '';

            if(sDate !== lastDate) {
                let displayDate = (sDate === todayStr) ? `আজকের সেল (Today)` : `তারিখ: ${sDate}`;
                html += `<tr style="background: #e0f2fe; color: #0369a1; border-top: 2px solid #bae6fd;"><td colspan="7" style="padding: 10px; font-size: 15px;"><b><i class="fa-solid fa-calendar-day"></i> ${displayDate}</b></td></tr>`; lastDate = sDate; 
            }
            html += `<tr><td><b>${s.invoice}</b><br><small style="color:#64748b;">${timeStr}</small></td><td>${sDate}</td><td><b>${s.customer}</b></td><td style="font-weight:bold; color:#1e293b;">৳ ${s.total.toFixed(2)}</td><td style="color:#10b981; font-weight:bold;">৳ ${s.paid.toFixed(2)}</td><td style="color:#ef4444; font-weight:bold;">৳ ${s.due.toFixed(2)}</td><td class="no-print" style="display:flex; gap:5px;"><button class="btn btn-primary btn-small" onclick="viewInvoice('${s.invoice}')" title="View"><i class="fa-solid fa-eye"></i></button><button class="btn btn-danger btn-small" onclick="deleteInvoice('${s.invoice}')" title="Delete"><i class="fa-solid fa-trash"></i></button></td></tr>`;
        }
    });

    tbody.innerHTML = html || `<tr><td colspan="7" style="text-align:center; padding:20px;">কোনো সেলস ডাটা নেই!</td></tr>`;
    let fts = document.getElementById('filter-total-sell'); if(fts) fts.innerText = `৳ ${tS.toFixed(2)}`;
    let ftp = document.getElementById('filter-total-paid'); if(ftp) ftp.innerText = `৳ ${tP.toFixed(2)}`;
    let ftd = document.getElementById('filter-total-due'); if(ftd) ftd.innerText = `৳ ${tD.toFixed(2)}`;
}

function filterSalesHistory() { let sel = document.getElementById('sales-customer-filter'); if(sel) renderSalesHistory(sel.value); }

function renderDueTable() {
    const tbody = document.getElementById('due-list-body'); if(!tbody) return; let debtors = customersDB.filter(c => c.due > 0).sort((a, b) => b.due - a.due); tbody.innerHTML = ''; let totalDue = 0;
    debtors.forEach(c => { totalDue += c.due; tbody.innerHTML += `<tr><td onclick="viewCustomerLedger('${c.name}')"><b>${c.name}</b><br><small>${c.phone}</small></td><td>Ledger</td><td style="color:#ef4444; font-weight:bold;">৳ ${c.due.toFixed(2)}</td><td class="no-print"><button class="btn btn-warning btn-small" onclick="viewCustomerLedger('${c.name}')">Collect</button></td></tr>`; });
    let tmd = document.getElementById('total-market-due-display'); if(tmd) tmd.innerText = `৳ ${totalDue.toFixed(2)}`;
}

// ================= COST & EXPENSES =================
function switchCostTab(type) { currentCostTab = type; let bD = document.getElementById('btn-daily-cost'); if(bD) bD.classList.replace(type==='daily'?'btn-outline':'btn-primary', type==='daily'?'btn-primary':'btn-outline'); let bM = document.getElementById('btn-monthly-cost'); if(bM) bM.classList.replace(type==='monthly'?'btn-outline':'btn-primary', type==='monthly'?'btn-primary':'btn-outline'); let eD = document.getElementById('exp-cat-daily'); if(eD) eD.classList.toggle('hidden', type!=='daily'); let eM = document.getElementById('exp-cat-monthly'); if(eM) eM.classList.toggle('hidden', type!=='monthly'); updateCostUI(); }
function saveCategory() { let catName = document.getElementById('newCatName').value; if(!catName) return; let t = currentCostTab === 'daily' ? document.getElementById('exp-cat-daily') : document.getElementById('exp-cat-monthly'); let opt = document.createElement('option'); opt.text = catName; t.add(opt); t.value = catName; document.getElementById('addCatModal').classList.add('hidden'); }
function addExpense() { let dCat = document.getElementById('exp-cat-daily'); let mCat = document.getElementById('exp-cat-monthly'); const cat = currentCostTab === 'daily' ? (dCat?dCat.value:'Other') : (mCat?mCat.value:'Other'); const amount = parseFloat(document.getElementById('exp-amount').value) || 0; if (amount === 0) return alert("টাকা দিন!"); expensesDB.unshift({ id: Date.now(), type: currentCostTab, cat: cat, amount: amount, date: new Date().toLocaleString('en-US'), rawDate: new Date().getTime() }); saveData(); updateCostUI(); switchDashboardView('daily'); document.getElementById('exp-amount').value = ''; document.getElementById('exp-note').value = ''; }
function deleteExpense(id) { expensesDB = expensesDB.filter(e => e.id !== id); saveData(); updateCostUI(); switchDashboardView('daily'); }
function updateCostUI() { const costList = document.getElementById('exp-list-body'); if(!costList) return; costList.innerHTML = ''; let total = 0; expensesDB.filter(e => e.type === currentCostTab).forEach(e => { total += e.amount; costList.innerHTML += `<tr><td>${e.cat} <small>(${e.date})</small></td><td style="color:#ef4444;">৳ ${e.amount.toFixed(2)}</td><td><button class="btn btn-danger btn-small" onclick="deleteExpense(${e.id})">X</button></td></tr>`; }); let ted = document.getElementById('total-exp-display'); if(ted) ted.innerText = `৳ ${total.toFixed(2)}`; }

// ================= ANALYTICS =================
function renderFullAnalytics() {
    let ttp = document.getElementById('stat-tot-prod'); if(ttp) ttp.innerText = productsDB.length; let ttc = document.getElementById('stat-tot-cus'); if(ttc) ttc.innerText = customersDB.length;
    let totDue = customersDB.reduce((sum, cus) => sum + cus.due, 0); let std = document.getElementById('stat-tot-due'); if(std) std.innerText = `৳ ${totDue.toFixed(2)}`; 
    let totSale = salesHistoryDB.reduce((sum, sale) => sum + sale.total, 0); let sts = document.getElementById('stat-tot-sale'); if(sts) sts.innerText = `৳ ${totSale.toFixed(2)}`; updateAdvChart();
}
function updateAdvChart() {
    let ctx = document.getElementById('advancedAnalyticsChart'); if(!ctx || typeof Chart === 'undefined') return;
    let salesData = new Array(12).fill(0); let profitData = new Array(12).fill(0); let costData = new Array(12).fill(0); let currentYear = new Date().getFullYear();
    salesHistoryDB.forEach(s => { let d = new Date(s.rawDate || s.date); if(d.getFullYear() === currentYear) { salesData[d.getMonth()] += s.total; profitData[d.getMonth()] += (s.profit !== undefined ? s.profit : (s.total * 0.15)); } });
    expensesDB.forEach(e => { let d = new Date(e.rawDate || e.date); if(d.getFullYear() === currentYear) { costData[d.getMonth()] += e.amount; } });
    if(advAnalyticsChart) advAnalyticsChart.destroy();
    advAnalyticsChart = new Chart(ctx, { type: 'line', data: { labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], datasets: [{ label: 'Sales (৳)', data: salesData, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.3 }, { label: 'Profit (৳)', data: profitData, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.3 }, { label: 'Cost (৳)', data: costData, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false } });
}

// ================= BRANDING & PROFILE =================
function handleGlobalLogoUpload(event) {
    const file = event.target.files[0]; if (!file) return; let uploadLabel = event.target.parentElement; let originalText = uploadLabel.innerHTML; uploadLabel.innerHTML = '<i class="fa-solid fa-spinner fa-spin fa-2x" style="display:block; margin-bottom:5px;"></i> আপলোড হচ্ছে...';
    const reader = new FileReader(); reader.onload = function(e) { const img = new Image(); img.onload = function() { const canvas = document.createElement('canvas'); const maxSize = 200; let width = img.width; let height = img.height; if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } } else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } } canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height); const compressedBase64 = canvas.toDataURL('image/png', 0.9); db.collection('system').doc('config').set({ globalLogo: compressedBase64 }, { merge: true }).then(() => { uploadLabel.innerHTML = originalText; alert("✅ গ্লোবাল লোগো সফলভাবে আপডেট হয়েছে!"); }); }; img.src = e.target.result; }; reader.readAsDataURL(file);
}

function applyGlobalBranding() {
    let appName = localStorage.getItem('smartpos_app_name') || "SmartPOS Pro"; let globalLogo = localStorage.getItem('smartpos_global_logo');
    if(document.getElementById('landing-app-name')) document.getElementById('landing-app-name').innerText = appName;
    if(document.getElementById('sidebar-app-name')) document.getElementById('sidebar-app-name').innerText = appName;
    if(globalLogo) {
        if(document.getElementById('landing-app-icon')) { document.getElementById('landing-app-icon').src = globalLogo; document.getElementById('landing-app-icon').style.display = 'inline-block'; if(document.getElementById('landing-app-icon-default')) document.getElementById('landing-app-icon-default').style.display = 'none'; }
        if(document.getElementById('sidebar-app-icon')) { document.getElementById('sidebar-app-icon').src = globalLogo; document.getElementById('sidebar-app-icon').style.display = 'inline-block'; if(document.getElementById('sidebar-app-icon-default')) document.getElementById('sidebar-app-icon-default').style.display = 'none'; }
    }
}

function applyShopBranding() {
    let shopNameText = "My Shop"; let userPic = null;
    if (currentShopID) { shopNameText = localStorage.getItem(`pos_${currentShopID}_shopname`) || "My Shop"; userPic = localStorage.getItem(`pos_${currentShopID}_user_pic`); }
    const logoTextH2 = document.getElementById('main-logo-text');
    if (logoTextH2) {
        if (userPic && userPic.startsWith('data:image')) { logoTextH2.innerHTML = `<img src="${userPic}" style="width: 35px; height: 35px; border-radius: 50%; object-fit: cover; vertical-align: middle; border: 2px solid #fff; margin-right: 5px;"> <span id="shop-name-display">${shopNameText}</span>`; } 
        else { logoTextH2.innerHTML = `<i class="fa-solid fa-store"></i> <span id="shop-name-display">${shopNameText}</span>`; }
    }
}

function previewUserProfileImage(event) {
    const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = function(e) { const img = new Image(); img.onload = function() { const canvas = document.createElement('canvas'); const maxSize = 150; let width = img.width; let height = img.height; if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } } else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } } canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height); document.getElementById('display-profile-img').src = canvas.toDataURL('image/jpeg', 0.8); }; img.src = e.target.result; }; reader.readAsDataURL(file);
}

function loadUserProfileData() {
    document.getElementById('profile-user-name').value = currentShopID ? (localStorage.getItem(`pos_${currentShopID}_user_name`) || "") : "";
    document.getElementById('profile-shop-name').value = currentShopID ? (localStorage.getItem(`pos_${currentShopID}_shopname`) || "My Shop") : "My Shop";
    document.getElementById('profile-user-phone').value = currentShopID ? (localStorage.getItem(`pos_${currentShopID}_wanumber`) || "") : "";
    document.getElementById('profile-user-email').value = currentShopID ? (localStorage.getItem(`pos_${currentShopID}_user_email`) || "") : "";
    document.getElementById('profile-display-shopid').value = currentShopID || "Not Logged In";
    const savedPic = currentShopID ? localStorage.getItem(`pos_${currentShopID}_user_pic`) : null;
    if (savedPic && savedPic.startsWith('data:image')) { document.getElementById('display-profile-img').src = savedPic; } else { document.getElementById('display-profile-img').src = "https://via.placeholder.com/100?text=User"; }
}

function saveUserProfile() {
    if(!currentShopID) return;
    const uName = document.getElementById('profile-user-name').value; let sName = document.getElementById('profile-shop-name').value; 
    if(!sName || sName.trim() === "") { sName = shopName || "My Shop"; document.getElementById('profile-shop-name').value = sName; }
    const uPhone = document.getElementById('profile-user-phone').value; const uEmail = document.getElementById('profile-user-email').value; const uPic = document.getElementById('display-profile-img').src;
    
    localStorage.setItem(`pos_${currentShopID}_user_name`, uName); localStorage.setItem(`pos_${currentShopID}_shopname`, sName); localStorage.setItem(`pos_${currentShopID}_wanumber`, uPhone); localStorage.setItem(`pos_${currentShopID}_user_email`, uEmail);
    if(uPic && uPic.startsWith('data:image')) { localStorage.setItem(`pos_${currentShopID}_user_pic`, uPic); } else { localStorage.removeItem(`pos_${currentShopID}_user_pic`); }
    
    shopName = sName; applyShopBranding(); 
    if (!currentShopID.startsWith("TRIAL-")) { db.collection('shops').doc(currentShopID).set({ ownerName: uName, shopName: sName, waNumber: uPhone, email: uEmail, profilePic: (uPic.startsWith('data:image') ? uPic : "") }, { merge: true }).then(() => { alert("✅ প্রোফাইল সফলভাবে আপডেট এবং ক্লাউডে সেভ হয়েছে!"); }); } 
    else { alert("✅ প্রোফাইল লোকালি সেভ হয়েছে! (ট্রায়াল মোড)"); }
}

// ================= BACKUP & PRINT =================
function downloadJSONBackup() {
    let backupData = { customers: customersDB, products: productsDB, sales: salesHistoryDB, due_collections: dueCollectionHistoryDB, expenses: expensesDB };
    let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    let dlAnchorElem = document.createElement('a'); dlAnchorElem.setAttribute("href", dataStr); dlAnchorElem.setAttribute("download", "SmartPOS_Backup_" + new Date().toISOString().split('T')[0] + ".json"); document.body.appendChild(dlAnchorElem); dlAnchorElem.click(); dlAnchorElem.remove();
}

function restoreJSONBackup(event) {
    let file = event.target.files[0]; if (!file) return; let reader = new FileReader();
    reader.onload = function(e) {
        try { let data = JSON.parse(e.target.result); if(data.customers) customersDB = data.customers; if(data.products) productsDB = data.products; if(data.sales) salesHistoryDB = data.sales; if(data.due_collections) dueCollectionHistoryDB = data.due_collections; if(data.expenses) expensesDB = data.expenses; saveData(); alert("✅ ব্যাকআপ সফলভাবে রিস্টোর হয়েছে!"); renderAllTables(); switchDashboardView('daily'); } 
        catch (err) { alert("❌ ভুল ফাইল ফরম্যাট! সঠিক JSON ফাইল আপলোড করুন।"); }
    }; reader.readAsText(file);
}

function printHTML(htmlContent) {
    let printFrame = document.getElementById('print-frame');
    if (!printFrame) { printFrame = document.createElement('iframe'); printFrame.id = 'print-frame'; printFrame.style.position = 'fixed'; printFrame.style.right = '0'; printFrame.style.bottom = '0'; printFrame.style.width = '0'; printFrame.style.height = '0'; printFrame.style.border = '0'; document.body.appendChild(printFrame); }
    let doc = printFrame.contentWindow.document; doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>SmartPOS Report</title><style>body { font-family: 'Hind Siliguri', sans-serif, Arial; color: #000; padding: 20px; background: white; } table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px; text-align: left; } th, td { border: 1px solid #cbd5e1; padding: 8px; } th { background: #f8fafc; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none !important; } img { max-width: 100%; height: auto; }</style></head><body>${htmlContent}</body></html>`);
    doc.close(); setTimeout(() => { printFrame.contentWindow.focus(); printFrame.contentWindow.print(); }, 500);
}

function printReport(areaId) { 
    const sourceArea = document.getElementById(areaId); if(!sourceArea) return alert("প্রিন্ট এরিয়া পাওয়া যাচ্ছে না!");
    let htmlContent = "";
    if (sourceArea.tagName.toLowerCase() === 'tbody') {
        let parentTable = sourceArea.closest('table');
        if (parentTable) { let cloneTable = parentTable.cloneNode(true); cloneTable.querySelectorAll('.no-print').forEach(el => el.remove()); htmlContent = cloneTable.outerHTML; } 
        else { htmlContent = `<table>${sourceArea.innerHTML}</table>`; }
    } else {
        let tempDiv = document.createElement('div'); tempDiv.innerHTML = sourceArea.outerHTML;
        let originalCanvases = sourceArea.getElementsByTagName('canvas'); let clonedCanvases = tempDiv.getElementsByTagName('canvas');
        for (let i = 0; i < originalCanvases.length; i++) { let img = document.createElement('img'); img.src = originalCanvases[i].toDataURL("image/png"); clonedCanvases[i].parentNode.replaceChild(img, clonedCanvases[i]); }
        tempDiv.querySelectorAll('.no-print').forEach(el => el.remove()); htmlContent = tempDiv.innerHTML;
    }
    let invoiceModal = document.getElementById('invoiceModal'); if(invoiceModal) invoiceModal.classList.add('hidden');
    printHTML(htmlContent);
}
