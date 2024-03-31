import { default as cv } from '@techstark/opencv-js';
import ReactDOM from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Root } from './Root.js';
import './index.css';

cv.onRuntimeInitialized = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    // <React.StrictMode>
      <HashRouter>
        <Routes>
          <Route path='/' element={<Root/>}/>
        </Routes>
      </HashRouter>
    // </React.StrictMode>
  );
};
