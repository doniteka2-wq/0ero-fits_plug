const token = localStorage.getItem('adminToken');
if (!token) {
  window.location.href = '/admin-login.html';
}

const authHeaders = { 'Authorization': 'Bearer ' + token };

// ---------- Metrics ----------
async function loadMetrics() {
  try {
    const res = await fetch('/api/admin/metrics', { headers: authHeaders });
    if (res.status === 401 || res.status === 403) return logout();

    const data = await res.json();
    console.log('Metrics:', data);

    document.getElementById('metricSales').textContent =
      Number(data.totalSales || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) + ' RWF';
    document.getElementById('metricUsers').textContent = data.activeUsers ?? 0;
    document.getElementById('metricPending').textContent = data.pendingOrders ?? 0;
  } catch (err) {
    console.error('Metrics failed:', err);
  }
}

// ---------- Activities ----------
async function loadActivities() {
  try {
    const res = await fetch('/api/admin/activities', { headers: authHeaders });
    if (res.status === 401 || res.status === 403) return logout();

    const activities = await res.json();
    const tbody = document.getElementById('activityTableBody');
    if (!tbody) return;

    if (!activities.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#888;padding:2rem;">No activities yet.</td></tr>';
      return;
    }

    tbody.innerHTML = activities.map(a => `
      <tr>
        <td>${a.activityId}</td>
        <td>${a.userName}</td>
        <td>${a.action}</td>
        <td>${a.status}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Activities failed:', err);
  }
}

// ---------- Orders ----------
async function loadOrders() {
  try {
    const res = await fetch('/api/admin/orders', { headers: authHeaders });
    if (res.status === 401 || res.status === 403) return logout();

    const orders = await res.json();
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;padding:2rem;">No orders yet.</td></tr>';
      return;
    }

    const recent = orders.slice(0, 10);

    tbody.innerHTML = recent.map(o => {
      const statusColor = o.status === 'Paid'
        ? '#2e7d32'
        : (o.status === 'Cancelled' ? '#c0392b' : '#f4a261');

      const waNumber = o.customerPhone.replace(/[^0-9]/g, '').replace(/^0/, '250');
      const waMessage = 'Hi ' + o.customerName + ', this is Fuego\'s Style regarding order ' + o.orderNumber + '.';
      const waLink = 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(waMessage);

      return `
        <tr>
          <td><strong>${o.orderNumber}</strong></td>
          <td>${o.customerName}</td>
          <td>
            <a href="tel:${o.customerPhone}" style="color:#f4a261;text-decoration:none;">${o.customerPhone}</a><br>
            <span style="color:#888;font-size:0.8rem;">${o.network}</span>
          </td>
          <td style="color:#f4a261;font-weight:700;">${Number(o.total).toFixed(2)} RWF</td>
          <td style="color:${statusColor};font-weight:600;">${o.status}</td>
          <td class="actions-cell">
            <a href="${waLink}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#25d366;color:white;text-decoration:none;">💬</a>
            <button class="btn btn-sm" style="background:#2e7d32;color:white;" onclick="setOrderStatus('${o.orderNumber}', 'Paid')">✓</button>
            <button class="btn btn-danger btn-sm" onclick="setOrderStatus('${o.orderNumber}', 'Cancelled')">✗</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Orders failed:', err);
  }
}

async function setOrderStatus(orderNumber, status) {
  if (!confirm('Mark ' + orderNumber + ' as ' + status + '?')) return;
  try {
    const res = await fetch('/api/admin/orders/' + orderNumber, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (data.success) {
      loadOrders();
      loadMetrics();
      loadActivities();
    } else {
      alert(data.message || 'Failed to update.');
    }
  } catch (err) {
    console.error(err);
    alert('Server error.');
  }
}

// ---------- Users ----------
async function loadUsers() {
  try {
    const res = await fetch('/api/admin/users', { headers: authHeaders });
    if (res.status === 401 || res.status === 403) return logout();

    const users = await res.json();
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;padding:2rem;">No users yet.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => `
      <tr>
        <td>${u.userId}</td>
        <td>${u.name}</td>
        <td>${u.email}</td>
        <td>${u.status || 'Active'}</td>
        <td class="actions-cell">
          <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.userId}')">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Users failed:', err);
  }
}

async function deleteUser(userId) {
  if (!confirm('Delete this user permanently?')) return;
  try {
    const res = await fetch('/api/admin/users/' + userId, {
      method: 'DELETE',
      headers: authHeaders
    });
    const data = await res.json();
    if (res.ok) {
      loadUsers();
      loadActivities();
      loadMetrics();
    } else {
      alert(data.message || 'Delete failed.');
    }
  } catch (err) {
    console.error(err);
    alert('Server error.');
  }
}

// ---------- Logout ----------
function logout() {
  localStorage.removeItem('adminToken');
  window.location.href = '/admin-login.html';
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  loadMetrics();
  loadActivities();
  loadOrders();
  loadUsers();

  // Auto-refresh orders and metrics every 30s
  setInterval(loadOrders, 30000);
  setInterval(loadMetrics, 30000);
});