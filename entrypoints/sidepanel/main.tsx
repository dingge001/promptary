import ReactDOM from 'react-dom/client';
import App from './App';
import '@/assets/tailwind.css';

// 刻意不套 StrictMode:它的开发期双调用 effect 会让「反推」这类
// 有副作用的操作重复触发,白白多花用户的 token 钱。
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
