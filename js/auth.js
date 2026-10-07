(function(){
  const form=document.getElementById('loginForm');
  if(!form) return;
  const err=document.getElementById('loginError');
  const userInput=document.getElementById('username');
  const passInput=document.getElementById('password');
  const toggle=document.getElementById('pwToggle');
  const btn=form.querySelector('button[type="submit"]');

  const showError=m=>{err.textContent=m;err.classList.remove('hidden');};
  const hideError=()=>err.classList.add('hidden');
  const setLoading=on=>{btn.disabled=on;btn.textContent=on?'INGRESANDO…':'INGRESAR';};
  const goTo=role=>{location.href=role==='admin'?'admin.html':'app.html';};

  // Con Live Server (u otro servidor estático) el login lo atiende el servidor Node local.
  // En Render queda vacío (mismo origen). Se puede forzar con window.API_BASE en firebase-config.js
  const isLocalStatic=(location.hostname==='localhost'||location.hostname==='127.0.0.1')&&location.port&&location.port!=='3000';
  const API_BASE=window.API_BASE!==undefined?window.API_BASE:(isLocalStatic?'http://localhost:3000':'');

  function getAuth(){
    if(!window.FIREBASE_READY) throw new Error('Falta configurar Firebase.');
    if(!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    return firebase.auth();
  }

  // Mostrar / ocultar contraseña
  toggle.addEventListener('click',()=>{
    const show=passInput.type==='password';
    passInput.type=show?'text':'password';
    toggle.setAttribute('aria-pressed',String(show));
    toggle.setAttribute('aria-label',show?'Ocultar contraseña':'Mostrar contraseña');
    passInput.focus();
  });

  [userInput,passInput].forEach(i=>i.addEventListener('input',hideError));

  // Si ya hay una sesión válida, entrar directo sin pedir login de nuevo
  try{
    const auth=getAuth();
    const off=auth.onAuthStateChanged(async u=>{
      off();
      if(!u) return;
      try{
        const t=await u.getIdTokenResult();
        const role=t.claims.role;
        if(role==='admin'||role==='mantenimiento') goTo(role); else await auth.signOut();
      }catch(_){}
    });
  }catch(_){}

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    hideError();
    const username=userInput.value.trim();
    const password=passInput.value;
    if(!username||!password){showError('Completá usuario y contraseña.');(username?passInput:userInput).focus();return;}

    setLoading(true);
    let redirecting=false;
    try{
      let response;
      try{
        response=await fetch(API_BASE+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
      }catch(_){
        throw new Error(API_BASE
          ?'No se pudo conectar con el servidor de login ('+API_BASE+'). Ejecutá "npm start" en la carpeta del proyecto.'
          :'No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo.');
      }
      const data=await response.json().catch(()=>({}));
      if(response.status===404||response.status===405) throw new Error('No existe el servidor de login (/api/login). Ejecutá "npm start" y abrí http://localhost:3000.');
      if(!response.ok) throw new Error(data.error||'Usuario o contraseña incorrectos.');

      await getAuth().signInWithCustomToken(data.token);
      sessionStorage.setItem('planningUser',JSON.stringify({username:data.username,role:data.role,name:data.name}));
      redirecting=true;
      goTo(data.role);
    }catch(e){
      showError(e.message||'No se pudo iniciar sesión.');
      if(/contraseña/i.test(e.message||'')){passInput.select();}
    }finally{
      if(!redirecting) setLoading(false);
    }
  });
})();
